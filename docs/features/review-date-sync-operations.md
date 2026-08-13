# Review-Date Sync — Operational Notes

Phase 1.2 production-hardening addendum to the SharePoint review-date
integration (ADR-0016 §17). Covers what's observable in production today,
correlation ID usage, and what's deliberately not implemented yet.

## Observability Guarantees

**Sync (`apps/worker/src/sharepoint-metadata/review-date-sync.ts`)** logs
exactly once per confirmed-library sync attempt — either a success line or
a failure line, never both, never zero (except the deliberately silent
no-mapping no-op, the overwhelmingly common case on every scan).

- **Success** (`ReviewDateSync succeeded ...`): `organizationId`, `siteId`,
  `graphListId`, `status` (`Active` or `Stale`), `documentsEvaluated`,
  `documentsUpdated`, `documentsSkippedEmpty`, `durationMs`,
  `correlationId`. Emitted both for a full sync and for a Stale-transition
  (the latter with all counts at 0 — it's a legitimate, non-error outcome,
  not a failure).
- **Failure** (`ReviewDateSync failed ...`): `organizationId`, `siteId`,
  `graphListId`, `operation` (`columnDiscovery` or `valueRetrieval`),
  `errorType`, `durationMs`, `correlationId`, plus the error message and
  stack.
- **Never logged**: document names, file paths, or field values (the
  review date itself, or any other SharePoint content). Only ids, counts,
  and status.

**Confirm (`apps/api/src/sharepoint-metadata/sharepoint-metadata.service.ts`)**
logs exactly once per confirm attempt, success or failure:

- **Success** (`ReviewDateConfirm succeeded ...`): `organizationId`,
  `siteId`, `graphListId`, `columnDefinitionId`, `columnDisplayName`,
  `confirmedByUserId`, `durationMs`, `correlationId`.
- **Failure** (`ReviewDateConfirm failed ...`): the same identifying
  fields plus `errorType` (covers validation rejections — `BadRequestException`/
  `ConflictException` — and genuine Graph/lookup failures — `NotFoundException`/
  `ServiceUnavailableException` — uniformly).

**Eligibility** (`checkReviewDateEligibility`) is deliberately **not**
logged — it's a read-only inspection action, not a lifecycle event, and
logging every check would be noisy without operational value. Its
externally observable behavior (response shape, thrown exceptions) is
unchanged from Phase 1.1.

**Format**: plain `key=value` lines via NestJS's standard `Logger`, matching
this codebase's existing convention (`apps/api/src/common/request-logger.middleware.ts`)
rather than introducing a new structured/JSON logging dependency.

**Not provided by this pass** (unchanged gaps, not silently fixed): no
persisted audit trail beyond the log lines themselves (still no
`AuditLog`/`GovernanceActivity` entry for a confirm action — an explicit,
separate decision if ever wanted, not introduced here), no aggregate
dashboard/query for "how many mappings are Stale org-wide" (a raw DB query
still answers this).

## Correlation ID Usage

Every Graph call this integration makes (`listColumns`, `listContentTypes`,
`listItemFields`, `listItemDriveItemIds`) now receives a `correlationId` via
the existing `ListOptions` parameter — no change to `packages/graph-client`
itself, which already supported this and simply wasn't being passed a value.

- One correlation ID is generated per sync attempt and per confirm attempt
  (`crypto.randomUUID()`), shared across every Graph call within that one
  attempt, and included in the resulting log line.
- Eligibility checks also generate and pass a correlation ID to their Graph
  calls (so a Graph-side error still carries one, via `GraphClientError`'s
  own `correlationId` field), even though eligibility itself doesn't log.
- Grep one correlation ID to see every Graph request plus the outcome for
  one attempt — no log-aggregation tooling required.

## Known Future Optimization Opportunities (documented, not implemented)

Each of these changes synchronization architecture and needs its own
separate design pass — listed here so they're not lost, not attempted in
this hardening pass:

- **Delta queries**: re-fetching full column/value sweeps every scan, even
  for an unchanged library, is avoidable via Graph's delta/change-tracking
  support. Would reduce steady-state Graph load for stable libraries.
- **Sync-state persistence**: a "last synced at" / "last known state hash"
  per mapping would let a sync skip work entirely when nothing changed —
  currently no such state is persisted (by design, to avoid a schema
  change in this pass).
- **Parallel drive processing**: confirmed-library syncs within one scan
  currently run strictly sequentially (`apps/worker/src/queue/document-collector.processor.ts`'s
  per-drive loop) — parallelizing across drives would reduce total scan
  duration for organizations with several confirmed libraries.
- **Caching**: `checkReviewDateEligibility` makes a live, uncached Graph
  round-trip on every call. No caching layer (Redis or otherwise) has been
  introduced — deliberately, per explicit instruction not to add
  speculative infrastructure. If a Phase 2 UI calls this endpoint
  frequently (e.g. polling), the UI itself should avoid unnecessary calls
  rather than this endpoint gaining caching speculatively.

## Eligibility Endpoint Protection

No server-side throttling was added — this codebase has no existing
rate-limiting pattern (`@nestjs/throttler` or equivalent) to reuse, and
introducing one speculatively for a single low-traffic, read-only endpoint
would be new infrastructure disproportionate to a demonstrated need.
Expected usage pattern: called on-demand by a future admin UI when a user
views a specific library's mapping state — not polled, not called in a
loop. If real usage ever contradicts this (e.g. a chatty UI), address it
at the call site first; only add server-side protection if that proves
insufficient.
