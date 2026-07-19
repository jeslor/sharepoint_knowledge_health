// See documents.ts header — same rationale (ADR-0009 shared API DTOs).

export interface MeResponse {
  id: string;
  role: string;
  organizationId: string;
  // Phase 10A.2: additive fields for the application shell's branded header
  // (user identity + connected-tenant context) — no schema change, both
  // already exist (User.displayName/email, MicrosoftTenant.tenantName).
  displayName: string;
  email: string;
  // null only if the organization somehow has no Consented tenant at the
  // moment /auth/me is called — structurally rare (TenantContextGuard
  // already requires one to provision a user), but not impossible (e.g. the
  // tenant is later revoked), so this stays nullable rather than assumed.
  tenantName: string | null;
}
