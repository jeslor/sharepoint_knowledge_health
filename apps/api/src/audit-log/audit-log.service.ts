import { Injectable } from '@nestjs/common';
import { createTenantContext, type AuditLog } from '@sph/database';
import type { AuditLogAction, AuditLogListQuery, AuditLogResponse, AuditLogTargetType, PaginatedResponse } from '@sph/types';

export interface RecordAuditLogInput {
  actorUserId: string | null;
  action: AuditLogAction;
  targetType: AuditLogTargetType;
  targetId: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * ADR-0019: single, centralized write path for AuditLog — every service
 * that performs an audited administrative action calls `record()` instead
 * of writing to the repository directly, the same "did this action get
 * logged is never left to each call site to remember" discipline
 * GovernanceActivityService already established for GovernanceActivity
 * (Phase 8C). Controllers never call this directly, and never write
 * AuditLog rows themselves.
 *
 * The row itself is append-only by construction — AuditLogRepository has
 * no update/delete method to call even if a future change wanted to.
 *
 * A sibling of GovernanceActivityService, not a replacement: that service
 * tracks one governed problem's workflow on one document; this one tracks
 * organization-wide administrative actions unrelated to any specific
 * document's governance thread. Deliberately does not import from or
 * delegate to GovernanceActivityService — the two write paths stay
 * independent, matching how the two models stay independent.
 */
@Injectable()
export class AuditLogService {
  async record(organizationId: string, input: RecordAuditLogInput): Promise<void> {
    const context = createTenantContext(organizationId);
    await context.auditLogs.create({
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      // Prisma's generated JSON input type doesn't structurally accept a
      // plain Record — this cast is the standard, documented workaround
      // (same as GovernanceActivityService.record).
      metadata: input.metadata === undefined || input.metadata === null ? undefined : (input.metadata as object),
    });
  }

  async list(organizationId: string, query: AuditLogListQuery): Promise<PaginatedResponse<AuditLogResponse>> {
    const context = createTenantContext(organizationId);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const sortDir = query.sortDir ?? 'desc';

    const createdAtFilter: { gte?: Date; lte?: Date } = {};
    if (query.since !== undefined) createdAtFilter.gte = new Date(query.since);
    if (query.until !== undefined) createdAtFilter.lte = new Date(query.until);

    const where = {
      ...(query.action !== undefined ? { action: query.action } : {}),
      ...(query.targetType !== undefined ? { targetType: query.targetType } : {}),
      ...(Object.keys(createdAtFilter).length > 0 ? { createdAt: createdAtFilter } : {}),
    };

    const [entries, total] = await Promise.all([
      context.auditLogs.findMany({
        where,
        orderBy: { createdAt: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      context.auditLogs.count({ where }),
    ]);

    const data = await this.enrich(organizationId, entries);
    return { data, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  // Batched actorUserName lookup — no N+1, matching
  // GovernanceActivityService's own enrich pattern.
  private async enrich(organizationId: string, entries: AuditLog[]): Promise<AuditLogResponse[]> {
    if (entries.length === 0) return [];

    const context = createTenantContext(organizationId);
    const actorIds = [...new Set(entries.map((entry) => entry.actorUserId).filter((id): id is string => id !== null))];
    const actors = actorIds.length > 0 ? await context.users.findMany({ where: { id: { in: actorIds } } }) : [];
    const actorNameById = new Map(actors.map((user) => [user.id, user.displayName]));

    return entries.map((entry) => ({
      id: entry.id,
      actorUserId: entry.actorUserId,
      actorUserName: entry.actorUserId !== null ? (actorNameById.get(entry.actorUserId) ?? 'Unknown user') : null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: (entry.metadata as Record<string, unknown> | null) ?? null,
      createdAt: entry.createdAt.toISOString(),
    }));
  }
}
