# ADR-0015: Continuous Knowledge Health Monitoring

Date: 2026-07-12
Status: Accepted

---

## Problem

Phases 5–6 built a fully working, but purely **on-demand** pipeline: an Admin
clicks "Start scan," `apps/worker` runs once, and the dashboard shows the
current state. There is no recurring scan, no historical trend data beyond
individual `HealthScore` rows accumulated incidentally, no visibility into
an in-progress scan beyond a static `Running` badge, and no notification
mechanism at all. `docs/features/document-health-score.md` promises
"Historical trends" as a dashboard feature — explicitly deferred out of
Phase 6 (see `docs/phases/phase-6-completion.md`) — and ADR-0004's own
"Future Considerations" already flagged "scheduled recurring scans" as the
anticipated next step. This ADR is that next step: define the architecture
for continuous monitoring before building it.

**No implementation happens in this ADR.** Status is `Proposed`, matching
how ADR-0013/0014 were written and reviewed before Phase 5 built against
them.

## Context (verified against the actual repo, not assumed)

- **`ScanJob`** (`prisma/schema.prisma`): `id, organizationId,
  microsoftTenantId, triggeredByUserId, status, startedAt, completedAt,
  documentsScanned, documentsFailed, errorSummary, createdAt`.
  `triggeredByUserId` is a **required** FK to `User` (`onDelete: Restrict`)
  — every `ScanJob` today has a human who clicked the button. There is no
  progress field beyond the two final counts, and no distinction between
  "who/what triggered this."
- **`HealthScore`** is already immutable and append-only — every scan
  writes new rows per document, never updates existing ones
  (`docs/phases/phase-5-completion.md` confirmed this is correct,
  intentional design, not a gap). This means **per-document** history
  already exists in the data model with zero schema change needed; what's
  missing is an **organization-level aggregate** history (today's
  `GET /organizations/:id/health-summary` computes "right now" on every
  request from scratch — there is no way to ask "what was the average
  score 30 days ago" without expensive reconstruction).
- **Queue**: one BullMQ queue (`SCAN_QUEUE`, `packages/types/src/scan.ts`),
  one processor (`DocumentCollectorProcessor`, `apps/worker`), producer-side
  `defaultJobOptions` (`attempts: 3`, exponential backoff — the Phase 5
  readiness review). No repeatable/cron jobs exist anywhere in the codebase
  today (confirmed — `queue.module.ts` only calls `registerQueue`, no
  `repeat` option).
- **Concurrency guard**: `ScansService.triggerScan` already blocks a new
  scan while one is `Queued`/`Running` for the same `MicrosoftTenant`
  (409). Any scheduling mechanism must respect this, not bypass it.
- **API**: `GET .../health-summary`, `GET .../document-health` (paginated/
  filterable), `GET .../documents/:documentId`, `GET .../scans`,
  `GET .../scans/:scanId`, `POST .../scans` (org-level, auto-resolves the
  tenant) and `POST .../microsoft-tenants/:tenantId/scans` (explicit). All
  guarded by `EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard`.
- **ADR-0001/ADR-0009 boundaries still apply**: everything below stays
  tenant-scoped via `createTenantContext(organizationId)`, and `apps/web`
  still never touches `packages/database`/`packages/graph-client`/BullMQ
  directly — only REST, per ADR-0009's confirmed boundary (Phase 6 added
  the `bullmq` import ban to `apps/web`'s eslint config specifically for
  this reason).

---

## 1. Scheduled scans

**Decision: a database-driven scheduler, not per-organization BullMQ
repeatable jobs.**

### Options considered

**A. One BullMQ repeatable job per organization** (`queue.add(name, data,
{ repeat: { pattern: cron } })`, added/removed as org admins change their
schedule). Rejected: creates a second source of truth (BullMQ's internal
repeat-job registry) that has to stay in sync with whatever the admin
configured in Postgres — updating a schedule means finding and removing
the old repeatable job by its BullMQ-assigned key and re-adding a new one,
which is fragile and has no natural audit trail if it drifts.

**B. A single periodic "scheduler tick" job + a `ScanSchedule` table**
(Postgres is the only source of truth). One repeatable BullMQ job
(registered once, at worker startup, not per-org), firing every N minutes,
that queries `ScanSchedule` rows where `enabled = true AND nextRunAt <=
now()`, and for each due row: creates a `ScanJob` and enqueues it through
the *exact same* `ScansService.triggerScan`-equivalent path already built
(same concurrency guard, same everything), then advances `nextRunAt`.

### Recommended: Option B.

- New `ScanSchedule` model: `organizationId, microsoftTenantId, frequency
  (enum: Daily, Weekly — not a free-form cron expression, avoiding a new
  cron-parsing dependency for an MVP that only needs two options),
  enabled, nextRunAt, lastTriggeredScanJobId (nullable FK), createdAt,
  updatedAt`. Unique on `(organizationId, microsoftTenantId)` — one
  schedule per connected tenant.
- The scheduler tick lives in `apps/worker` (it already owns all
  Postgres-writing scan logic) as a second, distinct `@Processor` on a
  new lightweight queue, or a `@Cron()`-style repeatable job registered via
  `BullModule.registerQueue({ ..., defaultJobOptions })` plus one
  `queue.add(..., { repeat: { every: 15 * 60 * 1000 } })` call made once
  at module init — 15 minutes is granular enough for "daily"/"weekly"
  frequencies without meaningful drift.
- If a scheduled tick finds a scan already `Queued`/`Running` for that
  tenant (the existing guard), it skips that tick and leaves `nextRunAt`
  unchanged so the next tick retries — a scheduled scan is never silently
  lost, only delayed.
- `ScanJob.triggeredByUserId` becomes **nullable**, plus a new
  `ScanJobTriggerSource` enum (`Manual`, `Scheduled`) — a scheduled scan
  has no human trigger, and inventing a synthetic "System" `User` row
  purely to satisfy a non-null FK would be worse than relaxing the
  constraint.

## 2. Scan history storage

**Already correctly modeled — no new table needed, one relaxation.**
`ScanJob` already accumulates every run as its own row; that *is* scan
history. The only real gap: nothing currently retains this forever by
design, and a future retention/pruning policy would need to account for
`HealthScore.scanJobId → ScanJob` being `onDelete: Cascade` — deleting old
`ScanJob` rows would cascade-delete the `HealthScore` rows that trend
calculations (§4) depend on. **Decision: no automatic pruning is proposed
in this ADR.** If storage growth becomes a real problem later, that's a
separate, explicit decision (archival strategy, not a delete), flagged
under Future Considerations, not solved speculatively here.

## 3. Health score snapshots

**Decision: a new `HealthSnapshot` model — one row per organization per
completed scan, capturing the same aggregate `HealthSummaryResponse`
computes on demand today, but persisted.**

This is the one genuinely new piece of state. Today's `health-summary`
endpoint is a live aggregate query with no memory of its own past results.
Reconstructing "what was the average score 30 days ago" from raw
`HealthScore` rows is possible but expensive and semantically fiddly (which
`HealthScore` counted as "current" for a given document *as of* a past
date, not just "created before" that date). A snapshot avoids all of that:
write the aggregate once, when it's already being computed anyway, and
read it back cheaply forever after.

`HealthSnapshot`: `id, organizationId, scanJobId (which scan produced
this), totalDocumentsScanned, averageHealthScore, criticalIssuesCount,
warningIssuesCount, capturedAt`. Written by
`DocumentCollectorProcessor.scoreTenantDocuments` immediately after it
finishes scoring — the exact same aggregation `HealthSummaryService`
already does, computed once more and persisted instead of discarded.
Index on `(organizationId, capturedAt)` for range queries.

## 4. Trend calculations

**Decision: trends are read directly off `HealthSnapshot` rows — no
computation beyond a range query, precisely because §3 already paid the
aggregation cost at write time.**

Two distinct trend views, matching two different real questions:

- **Organization-level trend** (`GET /organizations/:id/health-trends?days=30`,
  new): `HealthSnapshot.findMany({ where: { organizationId, capturedAt: {
  gte: since } }, orderBy: { capturedAt: 'asc' } })` — directly returns the
  chart-ready series. No new aggregation logic at read time.
- **Per-document trend** (`GET /organizations/:id/documents/:documentId/history`,
  new): needs **no schema change** — `HealthScore` rows already accumulate
  per-document across every scan; this is a `findMany({ where: {
  documentId }, orderBy: { calculatedAt: 'asc' } })` against data that
  already exists today.

## 5. Worker progress reporting

**Decision: progress is written to Postgres by the worker, not read from
BullMQ job state by the API — extending the same pattern already in use,
not introducing a second source of truth for scan status.**

Today `apps/api` never reads BullMQ job state directly (confirmed — only
`.add()` is called; all status reads go through the `ScanJob` Postgres
row). Keeping that pattern: add `totalSites`, `sitesCompleted`,
`currentSiteName` to `ScanJob`, updated by
`DocumentCollectorProcessor.collectSite`'s existing per-site loop — after
each site finishes (not per-document, which would be excessive write
volume for a tenant with thousands of documents across a handful of
sites). The dashboard's existing scan-status polling (built in Phase 6,
already polls every 5s while a scan is active) picks this up for free —
no new frontend polling mechanism needed, just more fields in the same
response it already refetches.

## 6. Future notification system (integration point only)

**Explicitly not designed in full here** — delivery channel (email? Teams
webhook? in-app?), preferences, digest-vs-real-time, and per-user opt-in
are real product decisions with no answer yet, and forcing a schema for
them now would be designing against guesses. What *is* architected: the
**hook point**, so building the real thing later doesn't require touching
the scan pipeline again.

`DocumentCollectorProcessor`, immediately after marking a `ScanJob`
terminal (`Completed`/`Failed`), enqueues one message onto a new
`NOTIFICATION_QUEUE` (`packages/types`, same pattern as `SCAN_QUEUE`):
`{ organizationId, scanJobId, outcome: 'Completed' | 'Failed',
criticalIssuesCount }`. No consumer exists yet — the queue can have zero
processors registered and messages simply accumulate/expire, which is
fine for an ADR that's explicitly not implementing delivery. This keeps
notification concerns decoupled from scan processing (a future
notification failure can never break or block a scan), matching the
queue-based decoupling ADR-0004 already established for the scan pipeline
itself.

---

## Proposed database changes

```prisma
enum ScanJobTriggerSource {
  Manual
  Scheduled
}

enum ScanScheduleFrequency {
  Daily
  Weekly
}

model ScanJob {
  // ...existing fields...
  triggeredByUserId String?              // was required — now nullable
  triggerSource     ScanJobTriggerSource @default(Manual)
  totalSites        Int?
  sitesCompleted    Int                  @default(0)
  currentSiteName   String?
}

model ScanSchedule {
  id                     String                 @id @default(cuid())
  organizationId         String
  microsoftTenantId      String
  frequency              ScanScheduleFrequency
  enabled                Boolean                @default(true)
  nextRunAt              DateTime
  lastTriggeredScanJobId String?
  createdAt              DateTime               @default(now())
  updatedAt              DateTime               @updatedAt

  organization    Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  microsoftTenant MicrosoftTenant @relation(fields: [microsoftTenantId], references: [id], onDelete: Cascade)

  @@unique([organizationId, microsoftTenantId])
  @@index([enabled, nextRunAt])
}

model HealthSnapshot {
  id                    String   @id @default(cuid())
  organizationId        String
  scanJobId             String
  totalDocumentsScanned Int
  averageHealthScore    Int?
  criticalIssuesCount   Int
  warningIssuesCount    Int
  capturedAt            DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  scanJob      ScanJob      @relation(fields: [scanJobId], references: [id], onDelete: Cascade)

  @@index([organizationId, capturedAt])
}
```

All additive; `triggeredByUserId` relaxing `NOT NULL` → nullable is a safe,
backward-compatible column change. No existing data loss.

## Proposed API changes

All new endpoints follow the existing `EntraJwtGuard, TenantContextGuard,
OrganizationAccessGuard` chain; mutations follow the existing `RolesGuard`
+ `@Roles('Admin')` pattern already used for scan triggering and site
approval.

| Method & path | Purpose | New/Extended |
|---|---|---|
| `GET /organizations/:id/scan-schedule` | Read the org's current schedule | New |
| `PUT /organizations/:id/scan-schedule` | Create/update (`frequency`, `enabled`, optional `microsoftTenantId`) | New, Admin-only |
| `DELETE /organizations/:id/scan-schedule` | Disable scheduling | New, Admin-only |
| `GET /organizations/:id/health-trends?days=30` | Org-level score/issue trend series | New |
| `GET /organizations/:id/documents/:documentId/history` | Per-document score history | New |
| `GET /organizations/:id/scans` / `/scans/:scanId` | Same routes | Extended — response gains `triggerSource`, `totalSites`, `sitesCompleted`, `currentSiteName` |

No existing response field is removed or renamed — additive only, matching
Phase 6's own "keep API contracts backward compatible" precedent.

## Proposed implementation phases (for a future Phase 7 build, not now)

1. **Foundation**: schema migration (all three model changes above) +
   worker progress reporting (§5). Lowest risk, immediately valuable
   (better visibility into an already-running scan) without depending on
   anything else in this ADR.
2. **Scheduling**: `ScanSchedule` CRUD API + the scheduler-tick job (§1).
   Depends on #1's `triggerSource`/nullable `triggeredByUserId` migration.
3. **Snapshots & trends**: worker writes `HealthSnapshot` at scan
   completion + the two trend endpoints (§3–4). Independent of #2 — can
   ship before or after scheduling; only depends on #1's migration existing.
4. **Notification hook (stub only)**: `NOTIFICATION_QUEUE` + the enqueue
   call in the worker, zero consumers. A placeholder for a real future
   phase, not a deliverable in itself.

Frontend work (schedule settings UI, trend charts, live progress bar) is
out of scope for this ADR entirely — it's a Phase 8-shaped dashboard
extension once this backend architecture exists, matching how Phase 6
followed Phase 5's pipeline rather than being designed together with it.

## Implementation notes (added as phases actually shipped)

**Phase 7A** delivered implementation phase #1 above in full: `ScanJob`
gained `totalSites`/`sitesCompleted`/`currentSiteName`, `HealthSnapshot`
is written at scan completion, and the dashboard shows live per-site
progress. Trend *endpoints* (§4) were **not** built yet — only the data
they'll read (`HealthSnapshot` rows) is now being captured.

**Phase 7B** delivered implementation phase #2 (scheduling, §1) with one
deliberate schema simplification vs. this ADR's original sketch, made
because it reuses more of the existing manual-trigger code path rather
than less:

- `ScanSchedule` has **no `microsoftTenantId`** and **no
  `lastTriggeredScanJobId`** FK. It is `organizationId @unique` (a true
  one-per-org singleton, not `@@unique([organizationId,
  microsoftTenantId])`), and `lastRunAt: DateTime?` replaces the
  `lastTriggeredScanJobId` FK. Tenant resolution at tick time is
  delegated to the exact same "the org's single `Consented`
  `MicrosoftTenant`" auto-resolve logic
  `ScansService.triggerScanForOrganization` already implements for manual
  scans (duplicated in `apps/worker`'s `SchedulerProcessor` since it
  cannot import across the `apps/api`/`apps/worker` boundary per
  ADR-0009) — one schedule per org was sufficient for the actual
  requirement and avoids a second, parallel tenant-selection UI.
- The mutation endpoint is **`POST` (create) + `PATCH` (partial
  update)**, not a single `PUT`, matching the CRUD-verb convention every
  other mutation endpoint in this codebase already uses (e.g. site
  approval, scan trigger) rather than introducing `PUT`'s
  replace-the-whole-resource semantics as a one-off.
- The scheduler tick itself runs as documented: a `apps/worker`-hosted
  BullMQ repeatable job (`SCHEDULER_QUEUE`, 15-minute interval, fixed
  `jobId: 'scheduler-heartbeat'`) drives `findDueScanSchedules()` (a
  second sanctioned cross-tenant query, alongside `identity.ts`'s
  `findUserByEntraIdentity`, documented the same way in
  `packages/database/src/scheduler.ts`), which creates `ScanJob` rows
  with `triggerSource: 'Scheduled'` and enqueues onto the **same**
  `SCAN_QUEUE` manual triggers use — scheduling is a producer, not a
  second execution path, exactly as required.

**Phase 7C** delivered implementation phase #3 (snapshots & trends, §3–4)
— the org-level trend endpoint and per-document history endpoint this ADR
originally deferred — plus two follow-on additions made in direct
response to a post-implementation architectural review:

- **HealthSnapshot immutability, confirmed not just assumed.** The review
  asked that historical values never be recalculated and that each
  completed `ScanJob` correspond to exactly one immutable `HealthSnapshot`.
  Both were already true by construction (the `scanJobId @unique`
  constraint plus `DocumentCollectorProcessor` only ever calling
  `healthSnapshots.create()`, never `.updateById()`/`.deleteById()`,
  confirmed by grep across the codebase) — recorded here as a verified
  invariant, not a new mechanism.
- **Dashboard trend cards** (`TrendCards`) were extended beyond a single
  delta-over-window number to the full stat set a Phase 7C review asked
  for: current score, previous score, highest/lowest/average score, total
  completed scans, and critical/warning issue counts — each with a
  colored up/down/stable indicator (green when the change is an
  improvement, red when it isn't; issue counts invert the color logic
  since a falling count is the improvement). All of this is computed
  **client-side** from the same `HealthTrendResponse.points` array the
  existing `GET /health-trends` endpoint already returns — no new query,
  consistent with §4's "no computation beyond a range query" at the API
  layer. `totalCompletedScans` is simply `points.length`, valid precisely
  because of the immutability invariant above (one snapshot per completed
  scan, so counting snapshots in the window *is* counting completed
  scans).
- **`GET /organizations/:id/scans/:scanId/comparison`** (new — not in this
  ADR's original proposed API table) — added per an explicit "historical
  comparisons" recommendation: when viewing a scan, show what changed
  since the immediately preceding one (score/critical/warning/document
  count deltas, plus newly-introduced and resolved issues). Implementation
  reuses existing relations only: the aggregate deltas read the current
  and immediately-prior `HealthSnapshot` rows for the org (ordered by
  `capturedAt`); the issue-level diff walks `HealthScore.scanJobId` →
  `HealthIssue.healthScoreId` (the same relation chain
  `documents.service.ts` already walks for the current-health view) for
  both scans and diffs by `(documentId, criterion)`. No schema change, no
  recalculation — a read-only comparison over data the pipeline already
  persists. Returns an all-null/empty shape (never a 404) when there's
  nothing to compare yet — the scan hasn't completed, or it's the
  organization's first scan — matching `health-summary`'s existing
  null-friendly convention.

**Not yet implemented**: implementation phase #4 (the notification stub —
`NOTIFICATION_QUEUE` and the enqueue call). Remains open, unclaimed
follow-on work under this ADR. Phase #3 (trend endpoints) is now done as
of Phase 7C, above.

## Risks

- **BullMQ repeatable-job reliability**: mitigated by making Postgres (not
  BullMQ's internal repeat registry) the source of truth for *what* should
  run and *when* — the repeatable job is just a heartbeat, not state.
- **Snapshot storage growth**: one `HealthSnapshot` row per organization
  per completed scan is small and bounded (nowhere near `HealthScore`'s
  per-document volume) — low risk, no mitigation needed at this scale.
- **Cascade-delete conflict with future retention**: flagged explicitly in
  §2 — any future `ScanJob` pruning must be designed with
  `HealthScore`/`HealthSnapshot` cascade behavior in mind, or trend data
  silently disappears. Not solved here; deliberately deferred.
- **Scheduler tick frequency vs. schedule precision**: a 15-minute tick
  means a "Daily" schedule can drift up to ~15 minutes from its nominal
  time. Acceptable for this product's actual need (freshness monitoring,
  not exact-time SLA), but worth stating plainly rather than implying
  precision that doesn't exist.
- **Timezone handling**: this ADR does not propose per-organization
  timezone configuration — `nextRunAt` is UTC-only for v1. Flagged as a
  real, deliberate MVP simplification (matches "avoid over-engineering"),
  not an oversight.
- **Notification scope creep**: the biggest risk to this specific item is
  someone implementing more than the stub described in §6 without a real
  delivery-channel decision first — explicitly bounded here to prevent
  that.
- **Worker write load from progress reporting**: bounded by updating
  per-site, not per-document, matching the existing `collectSite` loop
  granularity — no new risk beyond what the pipeline already does today.

## Future Considerations

- Per-organization configurable scan frequency beyond Daily/Weekly (custom
  cron) if customer demand appears — the `ScanScheduleFrequency` enum is a
  deliberately narrow MVP choice, not a permanent ceiling.
- `ScanJob`/`HealthScore` archival strategy once real retention pressure
  exists (see the cascade-delete risk above) — a genuinely separate future
  ADR, not pre-solved speculatively here.
- Real notification delivery (channel, preferences, digest cadence) once
  product requirements exist — §6 only reserves the integration point.
- Per-organization timezone-aware scheduling, if UTC-only proves
  insufficient in practice.
