import { Injectable, Logger } from '@nestjs/common';
import {
  createTenantContext,
  type GovernanceActivity,
  type GovernanceActivityType,
  type NotificationType,
  type TenantContext,
} from '@sph/database';
import {
  GOVERNANCE_ISSUE_SEVERITY_LABELS,
  GOVERNANCE_ISSUE_TYPE_LABELS,
  type GovernanceActivityListQuery,
  type GovernanceActivityResponse,
  type GovernanceIssueTypeValue,
  type IssueSeverityFilter,
  type PaginatedResponse,
} from '@sph/types';

export interface RecordActivityInput {
  governanceIssueId?: string | null;
  documentId: string;
  actorUserId: string;
  activityType: GovernanceActivityType;
  previousValue?: string | null;
  newValue?: string | null;
  metadata?: Record<string, unknown> | null;
  // ADR-0021 §3.2: when set, record() also creates a Notification for this
  // recipient. Deliberately supplied by the caller, already resolved and
  // validated (an Active user in this organization) — every caller that
  // sets this already does that validation for its own purposes (e.g.
  // updateIssue's assignment check), so record() never re-derives a
  // recipient from previousValue/newValue's display-only strings, and
  // never does its own User lookup on every call, including ones that
  // never notify.
  notifyUserId?: string | null;
  // Only used to enrich the notification message when notifyUserId is set
  // and the caller already has this in scope at zero extra query cost
  // (e.g. GovernanceIssue.issueType from the row it just updated) — never
  // triggers a lookup of its own.
  notifyIssueType?: string | null;
  // Same rationale as notifyIssueType — GovernanceIssue.severity is
  // already a column on the row every notifying caller already has in
  // hand (snapshotted at creation, never re-derived), so this is zero
  // extra cost for the caller.
  notifyIssueSeverity?: string | null;
}

// ADR-0021 §3.2: the deliberately narrow V1 trigger set — StatusChanged,
// ResolutionNoteUpdated, IssueCreated, and OwnerRemoved are intentionally
// absent (low value / pure noise if notified on every occurrence). Any
// activityType not in this map is silently non-notifying, regardless of
// whether notifyUserId is set — this is the single place that decision is
// made, so a future new activity type doesn't notify by accident.
const NOTIFIABLE_ACTIVITY_TYPES: Partial<Record<GovernanceActivityType, NotificationType>> = {
  IssueAssigned: 'IssueAssigned',
  AssigneeChanged: 'IssueAssigned',
  OwnerAssigned: 'OwnerAssigned',
  IssueReopened: 'IssueReopened',
};

// Enriches the pre-resolved, human-readable notification message with the
// document name, issue type, and severity — so a recipient can triage from
// the notification list alone, without opening every row. Every input is
// optional and gracefully omitted (never "undefined" in the rendered
// string) — a missing document name or severity degrades the message,
// never breaks it; with everything missing, this produces exactly the
// original, pre-enrichment message text.
function buildNotificationMessage(
  activityType: GovernanceActivityType,
  documentName: string | null,
  issueType?: string | null,
  severity?: string | null,
): string {
  const documentClause = documentName ? ` on "${documentName}"` : '';
  const typeLabel = issueType ? (GOVERNANCE_ISSUE_TYPE_LABELS[issueType as GovernanceIssueTypeValue] ?? issueType) : null;
  const severityLabel = severity ? (GOVERNANCE_ISSUE_SEVERITY_LABELS[severity as IssueSeverityFilter] ?? severity) : null;
  const details = [typeLabel, severityLabel].filter((part): part is string => part !== null);
  const detailSuffix = details.length > 0 ? ` (${details.join(', ')})` : '';

  switch (activityType) {
    case 'IssueAssigned':
    case 'AssigneeChanged':
      return `You were assigned a governance issue${documentClause}${detailSuffix}.`;
    case 'OwnerAssigned':
      return documentName ? `You were assigned as the owner of "${documentName}".` : 'You were assigned as the owner of a document.';
    case 'IssueReopened':
      return `A governance issue you're involved with was reopened${documentClause}${detailSuffix}.`;
    default:
      return 'You have a new governance notification.';
  }
}

/**
 * Single, centralized write path for GovernanceActivity (Phase 8C /
 * ADR-0016 implementation notes) — every governance-affecting service
 * (GovernanceIssuesService, DocumentsService's ownership methods) calls
 * `record()` instead of writing to the repository directly, so "did this
 * action get logged" is never a question left to each call site to
 * remember. The row itself is append-only by construction:
 * GovernanceActivityRepository has no update/delete method to call even
 * if a future change wanted to.
 *
 * ADR-0021: also the single centralized point notifications originate
 * from for every synchronous (human/API-driven) trigger — the same
 * "never left to a call site to remember" discipline applied to
 * notification-triggering, not just activity-logging.
 *
 * Phase D.2 review fix: GovernanceActivity is the primary, source-of-truth
 * write — it is never wrapped in a try/catch here, and a failure there
 * correctly still propagates to the caller. Notification creation is
 * strictly secondary and best-effort: by the time it runs, the governance
 * mutation this activity records has already succeeded (the caller's
 * business logic already committed before calling record()), so a
 * notification failure must never make that completed operation look like
 * it failed. Matches this codebase's existing best-effort/logged pattern
 * for non-critical side effects (e.g. apps/worker's own reconciliation
 * enqueue after a successful scan).
 */
@Injectable()
export class GovernanceActivityService {
  private readonly logger = new Logger(GovernanceActivityService.name);

  async record(organizationId: string, input: RecordActivityInput): Promise<void> {
    const context = createTenantContext(organizationId);
    await context.governanceActivity.create({
      governanceIssueId: input.governanceIssueId ?? null,
      documentId: input.documentId,
      actorUserId: input.actorUserId,
      activityType: input.activityType,
      previousValue: input.previousValue ?? null,
      newValue: input.newValue ?? null,
      // Prisma's generated JSON input type doesn't structurally accept a
      // plain Record — this cast is the standard, documented workaround.
      metadata: input.metadata === undefined || input.metadata === null ? undefined : (input.metadata as object),
    });

    if (!input.notifyUserId) return;
    const notificationType = NOTIFIABLE_ACTIVITY_TYPES[input.activityType];
    if (!notificationType) return;

    try {
      // Only reached on the already-narrow notifying path (notifyUserId
      // set AND this activity type is notifiable) — one extra, indexed
      // primary-key lookup per notification actually created, not per
      // activity write. Safe even in theory: GovernanceIssue.document is
      // onDelete: Cascade (schema.prisma), so the Document row is
      // guaranteed to exist for as long as the issue/activity referencing
      // it does. A null result (never expected, but handled rather than
      // assumed away) degrades the message gracefully instead of breaking it.
      const document = await context.documents.findFirstById(input.documentId);
      await context.notifications.create({
        userId: input.notifyUserId,
        type: notificationType,
        message: buildNotificationMessage(input.activityType, document?.name ?? null, input.notifyIssueType, input.notifyIssueSeverity),
        governanceIssueId: input.governanceIssueId ?? null,
        documentId: input.documentId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to create ${notificationType} notification for user ${input.notifyUserId} (activityType=${input.activityType}): ${message}`,
        stack,
      );
    }
  }

  async listIssueActivity(
    organizationId: string,
    issueId: string,
    query: GovernanceActivityListQuery,
  ): Promise<PaginatedResponse<GovernanceActivityResponse>> {
    return this.list(organizationId, { ...query, governanceIssueId: issueId });
  }

  async listOrganizationActivity(
    organizationId: string,
    query: GovernanceActivityListQuery,
  ): Promise<PaginatedResponse<GovernanceActivityResponse>> {
    return this.list(organizationId, query);
  }

  private async list(
    organizationId: string,
    query: GovernanceActivityListQuery & { governanceIssueId?: string },
  ): Promise<PaginatedResponse<GovernanceActivityResponse>> {
    const context = createTenantContext(organizationId);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const sortDir = query.sortDir ?? 'desc';

    const createdAtFilter: { gte?: Date; lte?: Date } = {};
    if (query.since !== undefined) createdAtFilter.gte = new Date(query.since);
    if (query.until !== undefined) createdAtFilter.lte = new Date(query.until);

    const where = {
      ...(query.governanceIssueId !== undefined ? { governanceIssueId: query.governanceIssueId } : {}),
      ...(query.activityType !== undefined ? { activityType: query.activityType } : {}),
      ...(Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {}),
    };

    const [activities, total] = await Promise.all([
      context.governanceActivity.findMany({
        where,
        orderBy: { createdAt: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      context.governanceActivity.count({ where }),
    ]);

    const data = await this.enrich(context, activities);
    return { data, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  // Batched (documentName/actorUserName) — no N+1, matching
  // GovernanceIssuesService's own enrichIssues pattern.
  private async enrich(context: TenantContext, activities: GovernanceActivity[]): Promise<GovernanceActivityResponse[]> {
    if (activities.length === 0) return [];

    const documentIds = [...new Set(activities.map((activity) => activity.documentId))];
    const actorIds = [...new Set(activities.map((activity) => activity.actorUserId))];

    const [documents, actors] = await Promise.all([
      context.documents.findMany({ where: { id: { in: documentIds } } }),
      context.users.findMany({ where: { id: { in: actorIds } } }),
    ]);

    const documentNameById = new Map(documents.map((document) => [document.id, document.name]));
    const actorNameById = new Map(actors.map((user) => [user.id, user.displayName]));

    return activities.map((activity) => ({
      id: activity.id,
      governanceIssueId: activity.governanceIssueId,
      documentId: activity.documentId,
      documentName: documentNameById.get(activity.documentId) ?? 'Unknown document',
      actorUserId: activity.actorUserId,
      actorUserName: actorNameById.get(activity.actorUserId) ?? 'Unknown user',
      activityType: activity.activityType,
      previousValue: activity.previousValue,
      newValue: activity.newValue,
      metadata: (activity.metadata as Record<string, unknown> | null) ?? null,
      createdAt: activity.createdAt.toISOString(),
    }));
  }
}
