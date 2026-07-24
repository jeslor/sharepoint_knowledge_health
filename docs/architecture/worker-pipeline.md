# Worker Pipeline

`apps/worker` is a NestJS **application context**, not an HTTP server
(`NestFactory.createApplicationContext`, ADR-0009) — this is enforced
structurally, not just by Container Apps ingress config: there is no
Express/Fastify adapter to expose a port on even by accident. It hosts two
independent BullMQ processors.

## 1. Document Collector (`SCAN_QUEUE`)

`apps/worker/src/queue/document-collector.processor.ts`,
`@Processor(SCAN_QUEUE, { concurrency: WORKER_CONCURRENCY ?? 5 })`.

Given a `ScanJobPayload { organizationId, scanJobId }`:

1. `createTenantContext(organizationId)` — every subsequent query in this
   job is scoped to this one tenant.
2. Loads the `ScanJob`; if missing, logs and returns (defensive — should be
   unreachable in practice).
3. Loads the `ScanJob`'s `MicrosoftTenant`; if missing, marks the job
   `Failed` with an `errorSummary` and returns.
4. Marks the job `Running`, sets `startedAt`.
5. Loads only `SharePointSite`s with `status: 'Approved'` for that tenant —
   the enforcement point for ADR-0014 (an Admin must explicitly approve a
   site before it's ever scanned).
6. **Per site** (each wrapped so one site's failure never aborts the
   others):
   - Updates `ScanJob.currentSiteName` (live progress, ADR-0015 §5 — per-
     site granularity, not per-document, to keep write volume sane on a
     large tenant).
   - Lists every drive on the site, then every file item in each drive via
     `@sph/graph-client` (`listDrives`/`listDocuments`, paginated async
     iterators). Folders (no `file` facet) are skipped.
   - **Upserts** each document by `(siteId, graphItemId)` — this is what
     makes a rescan idempotent; a document already known is updated in
     place, not duplicated.
   - **Reconciliation**: after a site's enumeration completes, any
     previously-`Active` `Document` whose `graphItemId` wasn't seen this
     pass is marked `Removed`. This only runs after a *successful* full
     enumeration of that site — a document is never marked `Removed`
     because of a partial/failed enumeration.
   - **Owner sync**: deletes then recreates only `DocumentOwner` rows with
     `source: 'GraphMetadata'` for that document, from the file's
     `createdBy` field. A `ManualAssignment`-sourced owner row (set through
     the governance API) is never touched here — it survives every future
     rescan unchanged (ADR-0016 §4.2).
   - Advances `ScanJob.sitesCompleted`; increments `documentsScanned`/
     `documentsFailed` counters.
7. **Scoring** (`scoreTenantDocuments`): loads every `Active` document for
   the tenant, batches owner lookups and duplicate-name/size sibling
   grouping up front (not per-document queries — this is the one place in
   the pipeline that deliberately batches to avoid an N+1 pattern), then
   calls `@sph/scoring`'s `calculateScore()` per document. Writes one
   `HealthScore` + its `HealthIssue`s per document, and points
   `Document.currentHealthScoreId` at it.
   - **ReviewStatus scoring input** (ADR-0002 amendment, accepted
     2026-07-23): `hasReviewDate` reads `document.nextReviewDueAt !== null`
     — a document with no review date set still correctly fails
     `ReviewStatus`, exactly as before this change. `nextReviewDueAt` is set
     today only through the manual review-date API (`PATCH
     /organizations/:id/documents/:documentId/review`, Admin/
     GovernanceManager, `reviewDateSource: Manual`). Graph's `driveItem`
     endpoint still has no native "review date" field — that requires
     SharePoint's separate List Items API, which `packages/graph-client`
     does not implement (ADR-0013 §8); syncing a Graph-sourced review date
     (`reviewDateSource: GraphMetadata`) into the same field remains future
     work (ADR-0016 §9).
8. Marks the `ScanJob` `Completed` (or `Failed`, if zero documents were
   scanned and at least one failure occurred), with an `errorSummary`
   (first 20 site-level errors, joined).
9. On `Completed` only, writes one `HealthSnapshot` — the point-in-time
   aggregate (`totalDocumentsScanned`, `averageHealthScore`,
   `criticalIssuesCount`, `warningIssuesCount`) that trend charts read.
   `HealthSnapshot.scanJobId` is unique — at most one per scan.

**Reliability**: BullMQ retries the job itself (`attempts: 3`, exponential
backoff — configured identically on both `apps/api`'s and `apps/worker`'s
registration of `SCAN_QUEUE`, Phase 9). The processor's own
`@OnWorkerEvent('failed'/'error')` hooks only add logging visibility on top
of that retry — they don't change retry behavior. Job history in Redis is
now bounded (`removeOnComplete`/`removeOnFail`, Phase 9); previously
unbounded, which meant unconstrained Redis growth in production.

## 2. Scheduler (`SCHEDULER_QUEUE`)

`apps/worker/src/scheduler/` — a heartbeat, not a second scan engine.

- **`SchedulerBootstrapService`** (`OnModuleInit`) registers one BullMQ
  *repeatable* job (`queue.add('tick', {}, { repeat: { every: 15min },
  jobId: 'scheduler-heartbeat' })`) on every worker boot. This is safe to
  call from every replica at startup: BullMQ's repeatable-job registration
  is idempotent at the Redis level for a given `jobId` + repeat options —
  multiple replicas calling it doesn't create multiple heartbeats, and
  BullMQ's existing per-job locking (the same mechanism that lets multiple
  replicas safely share `SCAN_QUEUE` today) guarantees only one replica
  actually processes each tick.
- **`SchedulerProcessor`** (`@Processor(SCHEDULER_QUEUE, { concurrency: 1 })`):
  1. `findDueScanSchedules(now)` — `packages/database`'s second sanctioned
     unscoped query (documented alongside `identity.ts`'s): "which
     schedules are due" is inherently cross-tenant, since no
     `organizationId` is known until *after* the due set is found.
  2. Per due schedule (each wrapped so one bad schedule never aborts the
     tick):
     - Resolves the org's single `Consented` `MicrosoftTenant` — the same
       check `ScansService.triggerScanForOrganization` performs in
       `apps/api`. Duplicated here deliberately (small, ~8 lines) rather
       than imported, since `apps/worker` structurally never depends on
       `apps/api` (ADR-0009). Zero or >1 consented tenants → skip + warn,
       `nextRunAt` left untouched (a config problem, not a transient one —
       an admin fixing it shouldn't have to wait out a full cycle anyway,
       since the next tick will simply retry the same check).
     - Checks for an in-flight `ScanJob` (`Queued`/`Running`) for that
       tenant — the exact same concurrency guard manual triggers use. If
       busy, skips this tick for this schedule, leaving `nextRunAt`/
       `lastRunAt` untouched so the next tick retries.
     - Creates a `ScanJob` (`triggerSource: 'Scheduled'`,
       `triggeredByUserId: null`) and enqueues `{ organizationId,
       scanJobId }` onto **`SCAN_QUEUE`** — the identical queue and payload
       shape a manual trigger uses. `DocumentCollectorProcessor` cannot
       distinguish a scheduled scan from a manual one, by design.
     - Advances `nextRunAt` from the *previous* `nextRunAt` (not `now`) to
       keep the schedule's intended time-of-day from drifting forward by
       however late a given tick happened to run; floors it at `now +
       interval` to prevent a burst of rapid catch-up scans if a schedule
       was disabled for a long time and just got re-enabled.

Retention on `SCHEDULER_QUEUE` is tighter than the scan queues
(`removeOnComplete: 100`, `removeOnFail: 500`) since it runs one small job
every 15 minutes — even 100 completed jobs is >24 hours of history.

## What the worker never does

- Never writes `GovernanceIssue`/`GovernanceActivity` rows — governance
  workflow and audit-trail writes are `apps/api`-only (user-initiated
  actions need an authenticated actor to attribute them to).
- Never exposes an HTTP endpoint of any kind (ADR-0009) — see
  `deployment.md` and `operations.md` for how liveness/readiness are
  established for a worker with no ingress.
- Never imports from `apps/api` or vice versa — the two apps share only
  `packages/*`.
