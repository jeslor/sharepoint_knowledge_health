import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createTenantContext, type User } from '@sph/database';
import type { OrganizationUserResponse } from '@sph/types';
import { AuditLogService } from '../audit-log/audit-log.service';

function toResponse(user: User): OrganizationUserResponse {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

/**
 * Phase 9.5: fills the gap ADR-0012 itself flagged and deliberately
 * deferred — a PendingApproval user (auto-provisioned on first sign-in
 * under an already-Consented MicrosoftTenant, per TenantContextGuard) had
 * no product path to Active status at all. "Reject" reuses the existing
 * UserStatus.Deactivated value rather than adding a new enum member —
 * there is no meaningful difference in this codebase between "never
 * approved" and "no longer active"; both simply deny access.
 */
@Injectable()
export class UsersService {
  constructor(private readonly auditLog: AuditLogService) {}

  async listUsers(organizationId: string): Promise<OrganizationUserResponse[]> {
    const context = createTenantContext(organizationId);
    const users = await context.users.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map(toResponse);
  }

  async approveUser(organizationId: string, userId: string, actorUserId: string): Promise<OrganizationUserResponse> {
    const user = await this.requirePending(organizationId, userId);
    const context = createTenantContext(organizationId);
    const updated = await context.users.updateById(user.id, { status: 'Active' });
    if (!updated) throw new NotFoundException('User not found');
    // Recorded only once the status transition has actually succeeded — a
    // rejected (409/404) request never reaches this line, so it never
    // produces an audit record for an action that didn't happen.
    await this.auditLog.record(organizationId, {
      actorUserId,
      action: 'user.approved',
      targetType: 'User',
      targetId: updated.id,
    });
    return toResponse(updated);
  }

  async rejectUser(organizationId: string, userId: string, actorUserId: string): Promise<OrganizationUserResponse> {
    const user = await this.requirePending(organizationId, userId);
    const context = createTenantContext(organizationId);
    const updated = await context.users.updateById(user.id, { status: 'Deactivated' });
    if (!updated) throw new NotFoundException('User not found');
    await this.auditLog.record(organizationId, {
      actorUserId,
      action: 'user.rejected',
      targetType: 'User',
      targetId: updated.id,
    });
    return toResponse(updated);
  }

  private async requirePending(organizationId: string, userId: string): Promise<User> {
    const context = createTenantContext(organizationId);
    const user = await context.users.findFirstById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.status !== 'PendingApproval') {
      throw new ConflictException('Only a pending user can be approved or rejected');
    }
    return user;
  }
}
