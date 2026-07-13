import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  createTenantContext,
  type GovernanceIssue,
  type GovernanceIssueStatus,
  type TenantContext,
} from '@sph/database';
import type {
  AssignableUserResponse,
  CreateGovernanceIssueRequest,
  GovernanceIssueListQuery,
  GovernanceIssueResponse,
  GovernanceSummaryResponse,
  PaginatedResponse,
  UpdateGovernanceIssueRequest,
} from '@sph/types';
import { GovernanceActivityService } from './governance-activity.service';

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

    const where = {
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.severity !== undefined ? { severity: query.severity } : {}),
      ...(query.assignedUserId !== undefined ? { assignedUserId: query.assignedUserId } : {}),
      ...(query.issueType !== undefined ? { issueType: query.issueType } : {}),
      ...(query.documentId !== undefined ? { documentId: query.documentId } : {}),
    };

    const [issues, total] = await Promise.all([
      context.governanceIssues.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      context.governanceIssues.count({ where }),
    ]);

    const data = await this.enrichIssues(context, issues);
    return { data, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
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

    const created = await context.governanceIssues.create({
      documentId: request.documentId,
      issueType: request.issueType,
      severity: matchingHealthIssue.severity,
    });

    await this.governanceActivityService.record(organizationId, {
      governanceIssueId: created.id,
      documentId: request.documentId,
      actorUserId,
      activityType: 'IssueCreated',
      metadata: { issueType: request.issueType, severity: matchingHealthIssue.severity },
    });

    const [enriched] = await this.enrichIssues(context, [created]);
    if (!enriched) throw new Error('Failed to enrich newly created GovernanceIssue');
    return enriched;
  }

  async updateIssue(
    organizationId: string,
    issueId: string,
    actorUserId: string,
    request: UpdateGovernanceIssueRequest,
  ): Promise<GovernanceIssueResponse | null> {
    const context = createTenantContext(organizationId);
    const existing = await context.governanceIssues.findFirstById(issueId);
    if (!existing) return null;

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
      await this.governanceActivityService.record(organizationId, {
        governanceIssueId: updated.id,
        documentId,
        actorUserId,
        activityType: STATUS_ACTIVITY_TYPE[updated.status],
        previousValue: previous.status,
        newValue: updated.status,
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

  async getSummary(organizationId: string): Promise<GovernanceSummaryResponse> {
    const context = createTenantContext(organizationId);
    const issues = await context.governanceIssues.findMany();

    const openCount = issues.filter((issue) => issue.status === 'Open').length;
    const inProgressCount = issues.filter((issue) => issue.status === 'InProgress').length;
    const resolvedCount = issues.filter((issue) => issue.status === 'Resolved').length;
    const criticalCount = issues.filter((issue) => issue.status !== 'Resolved' && issue.severity === 'RequiresReview').length;
    const assignedCount = issues.filter((issue) => issue.status !== 'Resolved' && issue.assignedUserId !== null).length;

    const byType: Record<string, number> = {};
    for (const issue of issues) {
      if (issue.status === 'Resolved') continue;
      byType[issue.issueType] = (byType[issue.issueType] ?? 0) + 1;
    }

    const totalCount = issues.length;
    const completionRate = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;

    // Calendar-month-to-date, UTC — a fixed snapshot window, deliberately
    // not the same as the analytics endpoint's queryable since/until
    // (Phase 8D §1 vs §2: the summary is "right now," analytics is
    // "over a window you pick").
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const createdThisMonth = issues.filter((issue) => issue.createdAt >= startOfMonth).length;
    const resolvedThisMonth = issues.filter(
      (issue) => issue.status === 'Resolved' && issue.resolvedAt !== null && issue.resolvedAt >= startOfMonth,
    ).length;

    // Mean(resolvedAt - createdAt) across currently Resolved issues. Since
    // resolvedAt is cleared on reopen (§4.5), this reflects each issue's
    // latest resolution cycle only, not the sum of every cycle if it was
    // reopened and resolved more than once — a deliberate simplification,
    // not a GovernanceIssue redesign; see ADR-0016 implementation notes.
    const resolvedWithTimestamps = issues.filter((issue) => issue.status === 'Resolved' && issue.resolvedAt !== null);
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
      };
    });
  }
}
