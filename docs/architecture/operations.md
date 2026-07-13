# Operations

Day-2 operational reference: health checks, logging, queue behavior, and
what to check first when something looks wrong. Reflects the Phase 9
hardening pass — before this phase, none of the health-check/logging
behavior below existed.

## Health checks

`apps/api` exposes two endpoints (`apps/api/src/health/`):

- **`GET /health`** — liveness. Always returns `{ status: 'ok', timestamp
  }` with a `200`. Deliberately checks nothing external — a transient
  Postgres/Redis blip must never cause an orchestrator to kill and restart
  a healthy process; that would just replace one outage with a worse one
  (a restart storm).
- **`GET /health/ready`** — readiness. Checks Postgres (`SELECT 1` via
  `checkDatabaseConnection()`, `packages/database`) and Redis (an `.info()`
  round-trip through a second, dedicated `BullMQ` `Queue` client —
  registered in `HealthModule` purely for this check, never used to
  enqueue anything) in parallel. Returns `200` with `status: 'ok'` if both
  succeed; throws `ServiceUnavailableException` (**`503`**) with
  `status: 'degraded'` and a per-dependency `checks: { database, redis }`
  breakdown if either fails. Point a Container Apps **readiness** probe
  here, and the **liveness** probe at plain `/health` — routing traffic
  should stop on a dependency outage, but the process itself shouldn't be
  restarted for it.

`apps/worker` has **no HTTP surface at all** (ADR-0009 — see
`worker-pipeline.md`), so it cannot be probed the same way. There is
nothing to fix here — a worker with an HTTP endpoint would contradict the
architecture decision, not correct an oversight. The correct probe
strategy for a no-ingress background worker is a **process-liveness**
check only (is the container process still running — Container Apps'
default behavior for a container without a configured HTTP probe), not an
HTTP-based one. Worker health is observed operationally instead through:
BullMQ job completion/failure rates (see below) and its own structured
logs.

## Logging

- Both `apps/api` and `apps/worker` use NestJS's built-in `Logger` — text
  output to stdout/stderr, one line per event, picked up by the container
  runtime's log driver (Azure Monitor/Log Analytics in production).
  **Not** structured JSON today — a real future improvement (see the
  Phase 9 report's roadmap), not fixed in this phase since it would touch
  every call site for no immediate operational gain.
- **Request correlation** (`apps/api` only, Phase 9): `RequestLoggerMiddleware`
  (`apps/api/src/common/request-logger.middleware.ts`) runs ahead of every
  route (including `/health`). It reuses an upstream-supplied
  `x-request-id` header if present (e.g. from Azure Front Door/App
  Gateway) rather than always minting a fresh one — so a single request's
  ID stays consistent end-to-end through any upstream proxy — otherwise
  generates one (`crypto.randomUUID()`). Echoes it on the response header
  and logs `METHOD path status durationMs [requestId]` once the response
  finishes. Never logs headers or body — confirmed by
  `request-logger.middleware.spec.ts`'s explicit "never logs secrets" test.
- `apps/worker` has no per-job correlation ID today — its logs key off
  `scanJobId`/`organizationId` (already present in every log line in
  `DocumentCollectorProcessor`/`SchedulerProcessor`), which serves the same
  purpose for tracing one scan's worker-side activity.
- Confirmed clean: no stray `console.log`, no token/secret/credential
  logged anywhere in `apps/api` or `apps/worker` (Phase 9 review).

## Queue reliability (BullMQ / Redis)

All three queue registrations (`SCAN_QUEUE` in both `apps/api` and
`apps/worker`, `SCHEDULER_QUEUE` in `apps/worker`) now share:

- `attempts: 3` with exponential backoff (`SCAN_QUEUE`: default BullMQ
  backoff; `SCHEDULER_QUEUE`: 5s initial delay, exponential) — a
  transient failure (a Graph throttling response, a DB blip) is retried
  automatically rather than permanently failing the job on the first
  error.
- **Bounded retention** (`removeOnComplete`/`removeOnFail`, Phase 9) —
  previously **unset on all three registrations**, meaning every completed
  and failed job stayed in Redis forever. Worst case was
  `SCHEDULER_QUEUE`'s 15-minute heartbeat: unbounded, that's roughly
  35,000 job records/year with no cap. Now: `SCAN_QUEUE` keeps the last
  500 completed / 1,000 failed; `SCHEDULER_QUEUE` (much higher frequency,
  much smaller/simpler jobs) keeps the last 100 completed / 500 failed —
  still >24 hours of heartbeat history.
- **No dead-letter queue or alerting** exists for a job that exhausts all
  3 attempts — it simply lands in the (now-bounded) failed set, visible
  via `@OnWorkerEvent('failed')`'s log line, but nothing pages anyone.
  This is an accepted gap for this phase (notifications/alerting are
  explicitly out of scope for Phase 9) — see the Phase 9 report's roadmap.
- **No queue inspection UI** (e.g. Bull Board) is installed — today,
  diagnosing a stuck/failed job means reading worker logs by
  `scanJobId`/`organizationId`, or querying Redis directly. Worth adding
  later; not a correctness gap, an operational-convenience one.
- **Idempotency**: a re-processed/retried scan job is safe to run again —
  `DocumentCollectorProcessor` upserts by `(siteId, graphItemId)` and only
  marks documents `Removed` after a *complete* successful enumeration pass
  (see `worker-pipeline.md`), so a retry after a partial failure doesn't
  corrupt state or double-count documents. The scheduler's in-flight guard
  (skip if a `Queued`/`Running` `ScanJob` already exists for that tenant)
  is what prevents the heartbeat itself from ever double-triggering a scan.

## Common operational questions

- **"Is a scan actually running for tenant X?"** — query `ScanJob` by
  `microsoftTenantId`, `status: { in: ['Queued', 'Running'] } }`; the same
  check the scheduler and manual trigger both use to avoid duplicates.
  Live per-site progress is on the row itself (`currentSiteName`,
  `sitesCompleted`/`totalSites`).
- **"Did the scheduler run at the expected time?"** — `ScanSchedule.lastRunAt`/
  `nextRunAt`, cross-referenced with `SchedulerProcessor`'s per-tick log
  line (`Scheduler tick: N due schedule(s) found`).
- **"Redis is down — what breaks?"** — new scan triggers/enqueues fail
  (surfacing as `apps/api` errors and a `degraded` `/health/ready`), and
  the scheduler tick can't fire. Dashboard **read** paths (health scores,
  summaries, governance issues, analytics) are unaffected — they only
  depend on Postgres, never Redis.
- **"Postgres is down — what breaks?"** — everything; both apps' readiness
  reports `degraded`, and every data path fails. There is no fallback data
  source.
- **"Migrations"** — applied via `prisma migrate deploy` as an explicit
  step (matching what CI already runs against its ephemeral database, see
  `deployment.md`); not run automatically on container boot in either app.

## Performance notes (documented, not changed this phase)

- `GovernanceIssuesService.getSummary()` and
  `GovernanceAnalyticsService.getAnalytics()` both load full result sets
  via `findMany()` and aggregate in application code, rather than using
  Postgres-level `groupBy`/`count`. This is a genuine scale limitation
  (will degrade as issue/document volume grows per tenant) but there is no
  evidence of an actual current problem, and "do not optimize
  prematurely" applies — flagged as a roadmap item, not fixed here.
- No N+1 query patterns were found in the request paths reviewed;
  `scoreTenantDocuments` (`apps/worker`) already batches owner/sibling
  lookups up front specifically to avoid one.
