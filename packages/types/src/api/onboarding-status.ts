// ADR-0017 (partial implementation — Phase 1b only covers the discovery
// slice; sitesApproved/scheduleConfigured/firstScanCompleted are later
// phases' fields, added to this same response as they're built, never a
// competing endpoint). See documents.ts header for the shared-DTO rationale
// (ADR-0009) — string unions here, not the Prisma enum types directly, so
// this package stays Prisma-free.

export type MicrosoftTenantStatusValue = 'PendingConsent' | 'Consented' | 'Revoked';
export type DiscoveryStatusValue = 'NotStarted' | 'Queued' | 'Running' | 'Completed' | 'Failed';

// microsoftTenantStatus/discoveryStatus are nullable — not an error state,
// a real one: an Organization with no MicrosoftTenant yet is a valid (if,
// per ADR-0012's atomic bootstrap, practically unreachable) fact to report,
// not a 404. This matters specifically because Phase 1c's frontend is
// required to be "purely reactive to backend state" — a response shape the
// UI can always render directly, with no HTTP-status-code branch to infer
// meaning from.
export interface OnboardingStatusResponse {
  microsoftTenantStatus: MicrosoftTenantStatusValue | null;
  discoveryStatus: DiscoveryStatusValue | null;
  discoveryStartedAt: string | null;
  discoveryCompletedAt: string | null;
  discoveryError: string | null;
}
