// Shared between apps/api (producer) and apps/worker (consumer) — the only
// contract that needs to stay in sync across the queue boundary (ADR-0004).
export const SCAN_QUEUE = 'scan-queue';

export interface ScanJobPayload {
  organizationId: string;
  scanJobId: string;
}
