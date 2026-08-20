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
  // ADR-0023 §3.10: additive, optional — combined signal for simple banner
  // rendering (packages/database's derivePermissionReconsentState). Absent
  // on 'bootstrapped' would also be valid (always false immediately after a
  // fresh bootstrap) but the backend sets it explicitly for every
  // non-rejected kind so the frontend never has to special-case its absence.
  needsReconsent?: boolean;
}

export type ConsentResolution =
  | ({ kind: 'existing' } & ConsentBootstrapResult)
  | ({ kind: 'bootstrapped' } & ConsentBootstrapResult)
  | ({ kind: 'provisioned-pending' } & ConsentBootstrapResult)
  // 'graph-consent-not-verified' was missing here even though
  // packages/database's own ConsentResolution has carried it since ADR-0012's
  // 2026-08-01 amendment — this mirror had drifted out of sync with the
  // actual backend union. Corrected while touching this type for ADR-0023.
  | { kind: 'rejected'; reason: 'tenant-not-consented' | 'graph-consent-not-verified' };
