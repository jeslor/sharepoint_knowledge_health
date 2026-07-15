// See documents.ts header — same rationale (ADR-0009 shared API DTOs).

export type UserRoleValue = 'Admin' | 'GovernanceManager' | 'Member';
export type UserStatusValue = 'Active' | 'Deactivated' | 'PendingApproval';

// Phase 9.5: the organization-roster view an Admin uses to approve/reject
// PendingApproval users — the gap ADR-0012 flagged and deliberately
// deferred ("an approval inbox/screen for Admins... doesn't exist yet").
export interface OrganizationUserResponse {
  id: string;
  email: string;
  displayName: string;
  role: UserRoleValue;
  status: UserStatusValue;
  createdAt: string;
  lastLoginAt: string | null;
}
