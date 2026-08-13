import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  createTenantContext,
  type GovernanceIssue,
  type GovernanceIssueStatus,
  type TenantContext,
  type UserRole,
} from '@sph/database';
import type {
  AssignableUserResponse,
  CreateGovernanceIssueRequest,
  GovernanceIssueListQuery,
  GovernanceIssueResponse,
  GovernanceIssueTypeCountsResponse,
  GovernanceSummaryResponse,
  PaginatedResponse,
  UpdateGovernanceIssueRequest,
} from '@sph/types';
import { GovernanceActivityService } from './governance-activity.service';
import { resolveOwnerUserId } from '../common/resolve-owner-user';

// ADR-0016 §4.5's StatusChanged/IssueResolved/IssueReopened activity types
// map exactly onto this 3-edge cycle, one edge each — see the schema
// comment on GovernanceActivityType for why StatusChanged only ever means
// the Open->InProgress edge.
const STATUS_ACTIVITY_TYPE: Record<GovernanceIssueStatus, 'StatusChanged' | 'IssueResolved' | 'IssueReopened'> = {
  InProgress: 'StatusChanged',
  Resolved: 'IssueResolved',
  Open: 'IssueReopened',
};

// ADR-0016 §4.5, confirmed on Phase 8B review: a strict 3-edge cycle, not
// the full bidirectional graph a literal reading of the ADR's ASCII
// diagram might suggest. One step forward at a time; reopening a Resolved
// issue always goes back to Open (never straight to InProgress), matching
// "RESOLVED → OPEN is a human action" exactly as written, with no
// additional shortcut invented here.
const ALLOWED_TRANSITIONS: Record<GovernanceIssueStatus, GovernanceIssueStatus[]> = {
  Open: ['InProgress'],
  InProgress: ['Resolved'],
  Resolved: ['Open'],
};

// ADR-0021 §3.6 / ADR-0016 §16.2: the assignee self-service exception is
// strictly narrower than ALLOWED_TRANSITIONS above — forward-only, no
// Resolved -> Open edge (reopening stays Admin/GovernanceManager-only, the
// ADR's own "more consequential, audit-sensitive" reasoning). Kept as its
// own constant, not a filtered view of ALLOWED_TRANSITIONS, so the
// self-service boundary is visible and grep-able on its own.
const SELF_SERVICE_ALLOWED_TRANSITIONS: Partial<Record<GovernanceIssueStatus, GovernanceIssueStatus[]>> = {
  Open: ['InProgress'],
  InProgress: ['Resolved'],
};

/**
 * User workflow state for governance findings (ADR-0016 §4.1). Never
 * touches HealthScore/HealthIssue/HealthSnapshot — those stay read-only,
 * scan-produced evidence; this service only ever reads them to enrich a
 * response (documentName, siteName, the derived "still detected" flag) or
 * to validate that a GovernanceIssue being opened corresponds to something
 * actually currently detected.
 */
@Injectable()
export class GovernanceIssuesService {
  constructor(private readonly governanceActivityService: GovernanceActivityService) {}

  async listIssues(
    organizationId: string,
    query: GovernanceIssueListQuery,
  ): Promise<PaginatedResponse<GovernanceIssueResponse>> {
    const context = createTenantContext(organizationId);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortDir = query.sortDir ?? 'desc';

    const where = this.buildListWhere(query);
    const orderBy = this.buildListOrderBy(sortBy, sortDir);

    const [issues, total] = await Promise.all([
      context.governanceIssues.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      context.governanceIssues.count({ where }),
    ]);

    const data = await this.enrichIssues(context, issues);
    return { data, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  // Phase 1 work-queue summary strip. Deliberately a single SQL-level
  // GROUP BY (GovernanceIssueRepository.groupByIssueType) — bounded to at
  // most 6 rows regardless of how many GovernanceIssue rows match, never
  // a findMany() + in-memory count. Reuses buildListWhere() so the counts
  // are always scoped identically to listIssues() for the same query —
  // including issueType itself, so an already-narrowed view naturally
  // yields a single-entry result rather than a second, different notion
  // of "current scope." Zero-count issue types are simply absent from the
  // result (GROUP BY never synthesizes empty groups) — matches the
  // existing convention already established by getSummary()'s own sparse
  // `byType` record and the IssuesByType component that renders it.
  async getIssueTypeCounts(organizationId: string, query: GovernanceIssueListQuery): Promise<GovernanceIssueTypeCountsResponse> {
    const context = createTenantContext(organizationId);
    const where = this.buildListWhere(query);
    const counts = await context.governanceIssues.groupByIssueType(where);

    const byType: Record<string, number> = {};
    for (const { issueType, count } of counts) {
      byType[issueType] = count;
    }
    return { byType };
  }

  // Shared with getIssueTypeCounts() so the work-queue summary strip's
  // counts always reflect the exact same effective filter scope as the
  // list it's paired with — one definition of "current view," not two
  // that could drift.
  private buildListWhere(query: GovernanceIssueListQuery) {
    return {
      ...(query.status !== undefined
        ? { status: query.status }
        : // Phase 1 work-queue default ("My Issues, not Resolved") — an
          // explicit `status` filter always wins; this never overrides one.
          // Mirrors the exact `status: { not: 'Resolved' }` shape
          // GovernanceAnalyticsService's issueAging view already uses.
          query.excludeResolved
          ? { status: { not: 'Resolved' as const } }
          : {}),
      ...(query.severity !== undefined ? { severity: query.severity } : {}),
      ...(query.assignedUserId !== undefined ? { assignedUserId: query.assignedUserId } : {}),
      ...(query.issueType !== undefined ? { issueType: query.issueType } : {}),
      ...(query.documentId !== undefined ? { documentId: query.documentId } : {}),
    };
  }

  // 'severity' is a fixed, deterministic ordering, not toggled by sortDir:
  // Postgres orders the native HealthIssueSeverity enum by declaration
  // order (NeedsAttention, RequiresReview — prisma/migrations/
  // 20260711185029_init_domain_model/migration.sql), so `desc` puts
  // RequiresReview (the more urgent value) first. createdAt ascending
  // (oldest first) is a fixed secondary key, matching the requirement that
  // same-severity issues are ordered deterministically, not left to
  // insertion order.
  private buildListOrderBy(sortBy: 'createdAt' | 'updatedAt' | 'severity', sortDir: 'asc' | 'desc') {
    if (sortBy === 'severity') {
      return [{ severity: 'desc' as const }, { createdAt: 'asc' as const }];
    }
    return { [sortBy]: sortDir };
  }

  async getIssue(organizationId: string, issueId: string): Promise<GovernanceIssueResponse | null> {
    const context = createTenantContext(organizationId);
    const issue = await context.governanceIssues.findFirstById(issueId);
    if (!issue) return null;

    const [enriched] = await this.enrichIssues(context, [issue]);
    return enriched ?? null;
  }

  // ADR-0016 §4.1: lazy creation — a GovernanceIssue can only be opened for
  // a problem the scan pipeline has actually, currently detected, and its
  // severity is snapshotted from that HealthIssue (never auto-updated by
  // later scans).
  async createIssue(
    organizationId: string,
    actorUserId: string,
    request: CreateGovernanceIssueRequest,
  ): Promise<GovernanceIssueResponse> {
    const context = createTenantContext(organizationId);

    const existing = await context.governanceIssues.findMany({
      where: { documentId: request.documentId, issueType: request.issueType },
      take: 1,
    });
    if (existing.length > 0) {
      throw new ConflictException(
        'A governance issue already exists for this document and issue type — use PATCH to update it',
      );
    }

    const document = await context.documents.findFirstById(request.documentId);
    if (!document) throw new NotFoundException('Document not found');
    if (!document.currentHealthScoreId) {
      throw new NotFoundException('This document has not been scored yet');
    }

    const [matchingHealthIssue] = await context.healthIssues.findMany({
      where: { healthScoreId: document.currentHealthScoreId, criterion: request.issueType },
      take: 1,
    });
    if (!matchingHealthIssue) {
      throw new NotFoundException('No currently-detected issue of this type exists on this document');
    }

    // ADR-0021 §3.5: a smarter default, not a forced rule — the document's
    // existing owner is a reasonable starting assignee, but never locks
    // anything in. The pre-existing updateIssue PATCH path already allows
    // reassigning (or unassigning) unconditionally at any time, exactly as
    // if this had been assigned by a human from the start.
    const defaultAssigneeId = await this.resolveDefaultAssignee(context, request.documentId);

    const created = await context.governanceIssues.create({
      documentId: request.documentId,
      issueType: request.issueType,
      severity: matchingHealthIssue.severity,
      assignedUserId: defaultAssigneeId,
      // Snapshotted once, same as severity above — never re-derived from a
      // later scan's HealthIssue (see the `message` field's own schema
      // comment for why).
      message: matchingHealthIssue.message,
    });

    await this.governanceActivityService.record(organizationId, {
      governanceIssueId: created.id,
      documentId: request.documentId,
      actorUserId,
      activityType: 'IssueCreated',
      metadata: { issueType: request.issueType, severity: matchingHealthIssue.severity },
    });

    // A separate GovernanceActivity row, not folded into IssueCreated's
    // metadata — mirrors recordUpdateActivity's own "one API call can
    // produce more than one activity row" precedent (a single PATCH that
    // changes both status and assignment already records two). Notifies
    // the same way an explicit assignment would (ADR-0021 §3.2) — from the
    // assignee's perspective, being auto-assigned is indistinguishable
    // from being assigned by a human, and they need to know either way.
    if (defaultAssigneeId) {
      const assignee = await context.users.findFirstById(defaultAssigneeId);
      await this.governanceActivityService.record(organizationId, {
        governanceIssueId: created.id,
        documentId: request.documentId,
        actorUserId,
        activityType: 'IssueAssigned',
        previousValue: null,
        newValue: assignee?.displayName ?? null,
        notifyUserId: defaultAssigneeId,
        notifyIssueType: request.issueType,
        notifyIssueSeverity: matchingHealthIssue.severity,
      });
    }

    const [enriched] = await this.enrichIssues(context, [created]);
    if (!enriched) throw new Error('Failed to enrich newly created GovernanceIssue');
    return enriched;
  }

  // ADR-0021 §3.6 / ADR-0016 §16.2: Admin/GovernanceManager are unrestricted
  // here (this is a no-op for them — every existing capability unchanged).
  // A Member who is the issue's CURRENT assignedUserId gains a narrow,
  // resource-scoped exception — checked fresh against the just-loaded row,
  // never a role change. Runs before ALLOWED_TRANSITIONS validation in
  // updateIssue so an unauthorized request is rejected for that reason
  // (403) rather than conflated with "is this even a valid transition"
  // (409). Rejects the ENTIRE request on any privileged field, even mixed
  // in alongside otherwise-permitted ones — nothing is partially applied,
  // since this runs before any write.
  private assertUpdateAuthorized(
    existing: GovernanceIssue,
    actorUserId: string,
    actorRole: UserRole,
    request: UpdateGovernanceIssueRequest,
  ): void {
    const isManager = actorRole === 'Admin' || actorRole === 'GovernanceManager';
    if (isManager) return;

    if (existing.assignedUserId !== actorUserId) {
      throw new ForbiddenException('You do not have permission to update this governance issue');
    }

    // No reassignment via self-service — not even a no-op "reassign to
    // self". The ADR's boundary is "reassigning," full stop, not
    // "reassigning to someone else"; rejecting the field outright avoids
    // any ambiguity.
    if (request.assignedUserId !== undefined) {
      throw new ForbiddenException('Only an Admin or Governance Manager can reassign a governance issue');
    }

    if (request.status !== undefined) {
      const allowed = SELF_SERVICE_ALLOWED_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(request.status)) {
        throw new ForbiddenException('Assignees can only move a governance issue forward (Open → InProgress → Resolved)');
      }
    }
    // resolutionNotes: no additional check — allowed for the assignee.
  }

  // Prefers a human's explicit ManualAssignment (most recent, if somehow
  // more than one exists) over the Graph-detected Author — a manual
  // assignment is a stronger ownership signal. Resolves to null (no
  // default) if there's no owner at all, or the owner's email doesn't
  // match a registered, Active platform User — an external or
  // unregistered owner is a normal, expected case, not an error.
  private async resolveDefaultAssignee(context: TenantContext, documentId: string): Promise<string | null> {
    const owners = await context.documentOwners.findMany({ where: { documentId } });
    if (owners.length === 0) return null;

    const manualOwners = owners.filter((owner) => owner.source === 'ManualAssignment');
    const candidates = manualOwners.length > 0 ? manualOwners : owners.filter((owner) => owner.ownerType === 'Author');

    const [best] = [...candidates].sort(
      (a, b) => (b.assignedAt?.getTime() ?? 0) - (a.assignedAt?.getTime() ?? 0),
    );
    if (!best) return null;

    return resolveOwnerUserId(context, best.email);
  }

  async updateIssue(
    organizationId: string,
    issueId: string,
    actorUserId: string,
    actorRole: UserRole,
    request: UpdateGovernanceIssueRequest,
  ): Promise<GovernanceIssueResponse | null> {
    const context = createTenantContext(organizationId);
    const existing = await context.governanceIssues.findFirstById(issueId);
    if (!existing) return null;

    this.assertUpdateAuthorized(existing, actorUserId, actorRole, request);

    const updateData: {
      status?: GovernanceIssueStatus;
      resolvedAt?: Date | null;
      assignedUserId?: string | null;
      resolutionNotes?: string | null;
    } = {};

    if (request.status !== undefined && request.status !== existing.status) {
      const allowed = ALLOWED_TRANSITIONS[existing.status];
      if (!allowed.includes(request.status)) {
        throw new ConflictException(`Cannot transition a governance issue from ${existing.status} to ${request.status}`);
      }
      updateData.status = request.status;
      updateData.resolvedAt = request.status === 'Resolved' ? new Date() : null;
    }

    let newAssigneeName: string | null | undefined;
    if (request.assignedUserId !== undefined) {
      if (request.assignedUserId !== null) {
        // Tenant-scoped by construction (ADR-0001) — findFirstById already
        // returns null for a user in a different organization, which is
        // exactly what "assignment must be organization scoped" requires.
        const assignee = await context.users.findFirstById(request.assignedUserId);
        if (!assignee) {
          throw new BadRequestException('assignedUserId does not resolve to a user in this organization');
        }
        if (assignee.status !== 'Active') {
          throw new BadRequestException('Cannot assign a governance issue to an inactive user');
        }
        newAssigneeName = assignee.displayName;
      } else {
        newAssigneeName = null;
      }
      updateData.assignedUserId = request.assignedUserId;
    }

    if (request.resolutionNotes !== undefined) {
      updateData.resolutionNotes = request.resolutionNotes;
    }

    const updated = await context.governanceIssues.updateById(issueId, updateData);
    if (!updated) return null;

    await this.recordUpdateActivity(context, organizationId, existing, updated, actorUserId, newAssigneeName);

    const [enriched] = await this.enrichIssues(context, [updated]);
    return enriched ?? null;
  }

  // Centralizes "what changed, therefore what to log" so updateIssue's
  // API-facing logic stays about validation/persistence, not activity
  // bookkeeping — one PATCH can legitimately record more than one
  // GovernanceActivity row (e.g. status + assignment changed together).
  private async recordUpdateActivity(
    context: TenantContext,
    organizationId: string,
    previous: GovernanceIssue,
    updated: GovernanceIssue,
    actorUserId: string,
    newAssigneeName: string | null | undefined,
  ): Promise<void> {
    const documentId = updated.documentId;

    if (updated.status !== previous.status) {
      const activityType = STATUS_ACTIVITY_TYPE[updated.status];
      await this.governanceActivityService.record(organizationId, {
        governanceIssueId: updated.id,
        documentId,
        actorUserId,
        activityType,
        previousValue: previous.status,
        newValue: updated.status,
        // Only the Resolved -> Open edge (IssueReopened) notifies — a
        // human already knows they just moved something to InProgress or
        // Resolved themselves (ADR-0021 §3.2's deliberately narrow trigger
        // set). Inert (no-op) if the issue is unassigned.
        notifyUserId: activityType === 'IssueReopened' ? updated.assignedUserId : null,
        notifyIssueType: updated.issueType,
        notifyIssueSeverity: updated.severity,
      });
    }

    if (updated.assignedUserId !== previous.assignedUserId) {
      // Both sides are resolved to display names before writing — an
      // activity row is always human-readable on its own, with no reader
      // ever needing a second lookup to make sense of previousValue.
      const previousAssigneeName = previous.assignedUserId
        ? ((await context.users.findFirstById(previous.assignedUserId))?.displayName ?? null)
        : null;

      await this.governanceActivityService.record(organizationId, {
        governanceIssueId: updated.id,
        documentId,
        actorUserId,
        activityType: previous.assignedUserId === null ? 'IssueAssigned' : 'AssigneeChanged',
        previousValue: previousAssigneeName,
        newValue: newAssigneeName ?? null,
        // The NEW assignee is the recipient — inert (no-op in record())
        // when this transition is an unassignment (updated.assignedUserId
        // is null), since there's no one to tell.
        notifyUserId: updated.assignedUserId,
        notifyIssueType: updated.issueType,
        notifyIssueSeverity: updated.severity,
      });
    }

    if (updated.resolutionNotes !== previous.resolutionNotes) {
      await this.governanceActivityService.record(organizationId, {
        governanceIssueId: updated.id,
        documentId,
        actorUserId,
        activityType: 'ResolutionNoteUpdated',
        previousValue: previous.resolutionNotes,
        newValue: updated.resolutionNotes,
      });
    }
  }

  // Scoped narrowly to "who can this issue be assigned to" — not a general
  // list-users endpoint. Active users only, matching updateIssue's own
  // assignment validation.
  async listAssignableUsers(organizationId: string): Promise<AssignableUserResponse[]> {
    const context = createTenantContext(organizationId);
    const users = await context.users.findMany({ where: { status: 'Active' }, orderBy: { displayName: 'asc' } });
    return users.map((user) => ({ id: user.id, displayName: user.displayName, email: user.email }));
  }

  // Scale-hardening pass: previously a single unbounded findMany() fetched
  // every GovernanceIssue in the organization (every column, every status)
  // just to filter/count/group it in Node — the exact anti-pattern
  // getIssueTypeCounts() was already built to avoid. Every metric below is
  // now either a bounded COUNT (cheap regardless of table size, scoped by
  // the existing @@index([organizationId, status]) index) or the existing
  // groupByIssueType() GROUP BY (already proven, reused as-is). Only
  // averageResolutionTimeHours still fetches rows into memory — Prisma has
  // no typed way to average a computed (resolvedAt - createdAt) expression
  // without raw SQL, so this one metric fetches ONLY the already-Resolved,
  // already-dated subset (a small, naturally-bounded set — an org's total
  // resolution history — not the full issue table) rather than forcing a
  // single narrow aggregate into raw SQL for this one field. Response
  // shape is byte-for-byte unchanged; totalCount is derived by summing the
  // three status counts (the enum is closed to exactly these three values,
  // per ALLOWED_TRANSITIONS) rather than a fourth query.
  async getSummary(organizationId: string): Promise<GovernanceSummaryResponse> {
    const context = createTenantContext(organizationId);

    // Calendar-month-to-date, UTC — a fixed snapshot window, deliberately
    // not the same as the analytics endpoint's queryable since/until
    // (Phase 8D §1 vs §2: the summary is "right now," analytics is
    // "over a window you pick").
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [
      openCount,
      inProgressCount,
      resolvedCount,
      criticalCount,
      assignedCount,
      byTypeCounts,
      resolvedWithTimestamps,
      createdThisMonth,
      resolvedThisMonth,
    ] = await Promise.all([
      context.governanceIssues.count({ where: { status: 'Open' } }),
      context.governanceIssues.count({ where: { status: 'InProgress' } }),
      context.governanceIssues.count({ where: { status: 'Resolved' } }),
      context.governanceIssues.count({ where: { status: { not: 'Resolved' }, severity: 'RequiresReview' } }),
      context.governanceIssues.count({ where: { status: { not: 'Resolved' }, assignedUserId: { not: null } } }),
      context.governanceIssues.groupByIssueType({ status: { not: 'Resolved' } }),
      // Mean(resolvedAt - createdAt) across currently Resolved issues. Since
      // resolvedAt is cleared on reopen (§4.5), this reflects each issue's
      // latest resolution cycle only, not the sum of every cycle if it was
      // reopened and resolved more than once — a deliberate simplification,
      // not a GovernanceIssue redesign; see ADR-0016 implementation notes.
      context.governanceIssues.findMany({ where: { status: 'Resolved', resolvedAt: { not: null } } }),
      context.governanceIssues.count({ where: { createdAt: { gte: startOfMonth } } }),
      context.governanceIssues.count({ where: { status: 'Resolved', resolvedAt: { gte: startOfMonth } } }),
    ]);

    const totalCount = openCount + inProgressCount + resolvedCount;
    const completionRate = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;

    const byType: Record<string, number> = {};
    for (const { issueType, count } of byTypeCounts) {
      byType[issueType] = count;
    }

    const averageResolutionTimeHours =
      resolvedWithTimestamps.length > 0
        ? resolvedWithTimestamps.reduce(
            (sum, issue) => sum + (issue.resolvedAt!.getTime() - issue.createdAt.getTime()),
            0,
          ) /
          resolvedWithTimestamps.length /
          (60 * 60 * 1000)
        : null;

    return {
      openCount,
      inProgressCount,
      resolvedCount,
      criticalCount,
      assignedCount,
      byType,
      totalCount,
      averageResolutionTimeHours,
      createdThisMonth,
      resolvedThisMonth,
      completionRate,
    };
  }

  // Batched enrichment (documentName/siteName/assignedUserName/stillDetected)
  // — no N+1, matching documents.service.ts's established pattern.
  private async enrichIssues(context: TenantContext, issues: GovernanceIssue[]): Promise<GovernanceIssueResponse[]> {
    if (issues.length === 0) return [];

    const documentIds = [...new Set(issues.map((issue) => issue.documentId))];
    const assignedUserIds = [
      ...new Set(issues.map((issue) => issue.assignedUserId).filter((id): id is string => id !== null)),
    ];

    const [documents, assignedUsers] = await Promise.all([
      context.documents.findMany({ where: { id: { in: documentIds } } }),
      assignedUserIds.length > 0 ? context.users.findMany({ where: { id: { in: assignedUserIds } } }) : [],
    ]);

    const siteIds = [...new Set(documents.map((document) => document.siteId))];
    const sites = siteIds.length > 0 ? await context.sharePointSites.findMany({ where: { id: { in: siteIds } } }) : [];

    const healthScoreIds = documents
      .map((document) => document.currentHealthScoreId)
      .filter((id): id is string => id !== null);
    const currentHealthIssues =
      healthScoreIds.length > 0
        ? await context.healthIssues.findMany({ where: { healthScoreId: { in: healthScoreIds } } })
        : [];

    const documentById = new Map(documents.map((document) => [document.id, document]));
    const siteNameById = new Map(sites.map((site) => [site.id, site.displayName]));
    const userNameById = new Map(assignedUsers.map((user) => [user.id, user.displayName]));
    const detectedKeySet = new Set(currentHealthIssues.map((issue) => `${issue.healthScoreId}:${issue.criterion}`));

    return issues.map((issue) => {
      const document = documentById.get(issue.documentId);
      const stillDetected = document?.currentHealthScoreId
        ? detectedKeySet.has(`${document.currentHealthScoreId}:${issue.issueType}`)
        : false;

      return {
        id: issue.id,
        documentId: issue.documentId,
        documentName: document?.name ?? 'Unknown document',
        siteName: document ? (siteNameById.get(document.siteId) ?? 'Unknown site') : 'Unknown site',
        issueType: issue.issueType,
        severity: issue.severity,
        status: issue.status,
        assignedUserId: issue.assignedUserId,
        assignedUserName: issue.assignedUserId ? (userNameById.get(issue.assignedUserId) ?? null) : null,
        resolutionNotes: issue.resolutionNotes,
        createdAt: issue.createdAt.toISOString(),
        updatedAt: issue.updatedAt.toISOString(),
        resolvedAt: issue.resolvedAt?.toISOString() ?? null,
        stillDetected,
        message: issue.message,
        documentWebUrl: document?.webUrl ?? null,
      };
    });
  }
}
