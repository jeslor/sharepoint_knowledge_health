// See documents.ts header — same rationale (ADR-0009 shared API DTOs).
// Mirrors packages/database/src/onboarding.ts's ConsentResolution discriminated
// union exactly — kept here too since apps/web (which cannot import
// @sph/database directly, per ADR-0009) needs the same shape to route on.

export interface ConsentCallbackRequest {
  idToken: string;
  tenantName: string;
}

interface ConsentBootstrapResult {
  organizationId: string;
  microsoftTenantId: string;
  userId: string;
}

export type ConsentResolution =
  | ({ kind: 'existing' } & ConsentBootstrapResult)
  | ({ kind: 'bootstrapped' } & ConsentBootstrapResult)
  | ({ kind: 'provisioned-pending' } & ConsentBootstrapResult)
  | { kind: 'rejected'; reason: 'tenant-not-consented' };
