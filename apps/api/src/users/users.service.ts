import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createTenantContext, type User } from '@sph/database';
import type { OrganizationUserResponse } from '@sph/types';

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
  async listUsers(organizationId: string): Promise<OrganizationUserResponse[]> {
    const context = createTenantContext(organizationId);
    const users = await context.users.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map(toResponse);
  }

  async approveUser(organizationId: string, userId: string): Promise<OrganizationUserResponse> {
    const user = await this.requirePending(organizationId, userId);
    const context = createTenantContext(organizationId);
    const updated = await context.users.updateById(user.id, { status: 'Active' });
    if (!updated) throw new NotFoundException('User not found');
    return toResponse(updated);
  }

  async rejectUser(organizationId: string, userId: string): Promise<OrganizationUserResponse> {
    const user = await this.requirePending(organizationId, userId);
    const context = createTenantContext(organizationId);
    const updated = await context.users.updateById(user.id, { status: 'Deactivated' });
    if (!updated) throw new NotFoundException('User not found');
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
