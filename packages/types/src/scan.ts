// Shared between apps/api (producer) and apps/worker (consumer) — the only
// contract that needs to stay in sync across the queue boundary (ADR-0004).
export const SCAN_QUEUE = 'scan-queue';

export interface ScanJobPayload {
  organizationId: string;
  scanJobId: string;
}

// Internal to apps/worker (Phase 7B, ADR-0015 §1) — the scheduler's own
// heartbeat queue. Never touched by apps/api; the scheduler tick itself
// only ever produces onto SCAN_QUEUE above, the same queue manual triggers
// use.
export const SCHEDULER_QUEUE = 'scheduler-queue';
