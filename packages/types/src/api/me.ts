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
  // Phase 6: Organization.name (this application's own tenant record) —
  // distinct from tenantName below, which is the connected Microsoft 365
  // tenant's name. Added for the "Request an upgrade" dialog's contextual
  // "Organization: {name}" line; display-only, never trusted as an
  // authorization input anywhere.
  organizationName: string;
  // null only if the organization somehow has no Consented tenant at the
  // moment /auth/me is called — structurally rare (TenantContextGuard
  // already requires one to provision a user), but not impossible (e.g. the
  // tenant is later revoked), so this stays nullable rather than assumed.
  tenantName: string | null;
  // ADR-0023 §3.4/§3.10: combined, derived signal — a real Graph-verified
  // read-scope gap OR the admin never asserting consent for the current
  // required version. Never implies Sites.ReadWrite.All has been
  // independently verified either way (ADR-0023 §3.3). Always false when
  // there's no Consented tenant to evaluate. Optional (rather than
  // required) purely to keep this an additive change for every existing
  // MeResponse test fixture in apps/web — the real backend always sets it.
  needsReconsent?: boolean;
  // ADR-0022 write-back MVP: whether the connected tenant still needs an
  // admin-consent redirect for the current required permission version
  // (which, at v2, is the one that includes Sites.ReadWrite.All). This is
  // the write-back-specific slice of needsReconsent — the UI uses it to
  // gate the review-date remediation action so a user never submits a job
  // that is guaranteed to fail for lack of the write scope. Derived from
  // needsWriteConsentAssertion (ADR-0023 §3.4); never a proof the write
  // grant is present, only that the consent redirect for the current set
  // has (not) been completed. Always false when there's no Consented
  // tenant. Optional for the same additive-fixture reason as above.
  needsWriteConsent?: boolean;
}
