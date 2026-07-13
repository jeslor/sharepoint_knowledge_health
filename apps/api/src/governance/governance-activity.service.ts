import { Injectable } from '@nestjs/common';
import { createTenantContext, type GovernanceActivity, type GovernanceActivityType, type TenantContext } from '@sph/database';
import type { GovernanceActivityListQuery, GovernanceActivityResponse, PaginatedResponse } from '@sph/types';

export interface RecordActivityInput {
  governanceIssueId?: string | null;
  documentId: string;
  actorUserId: string;
  activityType: GovernanceActivityType;
  previousValue?: string | null;
  newValue?: string | null;
  metadata?: Record<string, unknown> | null;
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
 */
@Injectable()
export class GovernanceActivityService {
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
