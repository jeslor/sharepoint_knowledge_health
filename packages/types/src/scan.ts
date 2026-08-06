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

// Shared between apps/api (producer, Phase 1b) and apps/worker (consumer,
// Phase 1a) — ADR-0014's amendment. Discovery has exactly one execution
// path regardless of what triggers it (consent-callback bootstrap, the
// manual "Discover sites" button, or a future reconnect), matching
// SCAN_QUEUE's own "scheduling is a producer, never a second execution
// path" discipline.
export const DISCOVERY_QUEUE = 'discovery-queue';

export interface DiscoveryJobPayload {
  organizationId: string;
  microsoftTenantId: string;
}

// ADR-0021 §3.3: per-organization notification reconciliation work — one
// job per org, produced two ways (both converging on this one execution
// path, matching SCAN_QUEUE's own "scheduling is a producer, never a
// second execution path" discipline):
//  - event-driven (primary): apps/worker's DocumentCollectorProcessor
//    enqueues one job here immediately after a scan completes.
//  - periodic safety net (fallback): NotificationReconciliationSweepProcessor
//    (below) enqueues one job per organization with an Open/InProgress
//    GovernanceIssue, on a low-frequency tick, to recover from a missed or
//    failed event-driven enqueue.
export const NOTIFICATION_RECONCILIATION_QUEUE = 'notification-reconciliation-queue';

export interface NotificationReconciliationJobPayload {
  organizationId: string;
}

// Internal to apps/worker, mirrors SCHEDULER_QUEUE's exact shape — a
// low-frequency heartbeat that only ever produces onto
// NOTIFICATION_RECONCILIATION_QUEUE above, never a second reconciliation
// execution path of its own.
export const NOTIFICATION_RECONCILIATION_SWEEP_QUEUE = 'notification-reconciliation-sweep-queue';
