import { Injectable } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import type { NotificationListQuery, NotificationResponse, PaginatedResponse } from '@sph/types';

/**
 * ADR-0021: a per-user inbox, not a duplicate of GovernanceActivityService/
 * AuditLogService's organization-wide feeds — every read here is scoped to
 * the requesting user, not just the organization. `NotificationRepository`
 * itself only enforces organizationId (matching every other repository,
 * ADR-0001); the userId boundary is this service's own responsibility,
 * the same "resource-scoped, not just tenant-scoped" discipline
 * `PATCH .../issues/:issueId`'s assignee self-service exception applies
 * (ADR-0021 §3.6) — a user must never be able to act on another user's
 * notification just because they share an organization.
 */
@Injectable()
export class NotificationsService {
  async list(organizationId: string, userId: string, query: NotificationListQuery): Promise<PaginatedResponse<NotificationResponse>> {
    const context = createTenantContext(organizationId);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const sortDir = query.sortDir ?? 'desc';

    const where = {
      userId,
      ...(query.read !== undefined ? { read: query.read } : {}),
    };

    const [notifications, total] = await Promise.all([
      context.notifications.findMany({
        where,
        orderBy: { createdAt: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      context.notifications.count({ where }),
    ]);

    return {
      data: notifications.map((notification) => ({
        id: notification.id,
        type: notification.type,
        message: notification.message,
        governanceIssueId: notification.governanceIssueId,
        documentId: notification.documentId,
        read: notification.read,
        createdAt: notification.createdAt.toISOString(),
      })),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async unreadCount(organizationId: string, userId: string): Promise<number> {
    const context = createTenantContext(organizationId);
    return context.notifications.count({ where: { userId, read: false } });
  }

  // Returns null both when the notification doesn't exist for this
  // organization at all, and when it exists but belongs to a different
  // user — the caller (controller) treats both identically (404), so a
  // user can't distinguish "not found" from "not yours" by response shape.
  async markRead(organizationId: string, userId: string, notificationId: string): Promise<NotificationResponse | null> {
    const context = createTenantContext(organizationId);
    const existing = await context.notifications.findFirstById(notificationId);
    if (!existing || existing.userId !== userId) return null;

    const updated = await context.notifications.markRead(notificationId);
    if (!updated) return null;

    return {
      id: updated.id,
      type: updated.type,
      message: updated.message,
      governanceIssueId: updated.governanceIssueId,
      documentId: updated.documentId,
      read: updated.read,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async markAllRead(organizationId: string, userId: string): Promise<number> {
    const context = createTenantContext(organizationId);
    return context.notifications.markAllReadForUser(userId);
  }
}
