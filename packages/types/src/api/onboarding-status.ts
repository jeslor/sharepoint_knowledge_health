// ADR-0017 (partial implementation — Phase 1b only covers the discovery
// slice; sitesApproved/scheduleConfigured/firstScanCompleted are later
// phases' fields, added to this same response as they're built, never a
// competing endpoint). See documents.ts header for the shared-DTO rationale
// (ADR-0009) — string unions here, not the Prisma enum types directly, so
// this package stays Prisma-free.

export type MicrosoftTenantStatusValue = 'PendingConsent' | 'Consented' | 'Revoked';
export type DiscoveryStatusValue = 'NotStarted' | 'Queued' | 'Running' | 'Completed' | 'Failed';

export interface OnboardingStatusResponse {
  microsoftTenantStatus: MicrosoftTenantStatusValue;
  discoveryStatus: DiscoveryStatusValue;
  discoveryStartedAt: string | null;
  discoveryCompletedAt: string | null;
  discoveryError: string | null;
}
