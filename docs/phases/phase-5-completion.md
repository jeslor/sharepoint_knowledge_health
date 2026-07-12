# Phase 5 Completion Notes — Document Health Score Foundation

Date: 2026-07-12
Status: Approved for production, with documented follow-ups (see Known Limitations)

## Scope delivered

Microsoft Graph → Document Collector (`apps/worker`) → Postgres → Scoring
Engine (`packages/scoring`) → API (`apps/api`), plus the full ADR-0014
site-discovery/admin-approval workflow. See ADR-0002, ADR-0004, ADR-0007,
ADR-0013, ADR-0014 for the accepted design; this doc covers delivery status
and the production readiness review performed before Phase 6.

## Production readiness review (2026-07-12)

Performed before starting Phase 6, per standing instruction to review before
extending. Findings below; all code fixes were applied and are covered by
tests (`pnpm exec turbo run lint typecheck test build` — 32/32 tasks green).

### 1. Architecture — verified compliant

- **Package boundaries**: `packages/graph-client` and `packages/scoring`
  have zero `@sph/*` imports (confirmed by dependency graph inspection, not
  just the `eslint no-restricted-imports` rules that also enforce this).
  Both are leaves in the dependency graph.
- **Circular dependencies**: none. Import graph is strictly one-directional:
  `apps/{api,worker} → packages/{database,graph-client,scoring,types}`, with
  no package importing another package and no package importing an app.
- **Business logic vs. infrastructure**: `packages/scoring` is pure
  functions over plain data (`ScoringInput`), no Prisma/BullMQ/HTTP
  awareness. `packages/graph-client` exposes only Graph-shaped DTOs and
  read-only operations (`listSites`/`listDrives`/`listDocuments`, verified
  — zero `.post()`/`.put()`/`.patch()`/`.delete()` calls anywhere in the
  package). All product-specific orchestration (mapping Graph DTOs to
  domain rows, deciding what to persist, deciding when to score) lives in
  `apps/worker`'s `DocumentCollectorProcessor`, as ADR-0013 assigns it.

### 2. Security — verified compliant

- **Tenant isolation**: every repository call in the pipeline goes through
  `createTenantContext(organizationId)`; every repository method scopes its
  Prisma query by `organizationId` internally (not just by convention —
  `updateById`/`findFirstById` literally include it in the `WHERE` clause).
- **IDOR protection**: `OrganizationAccessGuard` rejects any request where
  the `:id` route param doesn't match `request.user.organizationId` (403),
  on every controller in the pipeline. Covered by
  `organization-access.guard.spec.ts`. Even without the guard, the
  tenant-scoped repository layer is a second, independent enforcement point
  — a mismatched org/resource id resolves to zero rows, not another
  tenant's data.
- **Worker job cross-tenant safety**: a scan job's `organizationId` is set
  server-side from the already-guard-validated route param, never from
  client input directly. Even a hypothetically tampered job payload fails
  closed: `ScanJob.findFirstById` is scoped by both `id` and
  `organizationId`, so a mismatched pair simply resolves to "not found," not
  another tenant's job.
- **Microsoft Graph permission boundary**: confirmed `packages/graph-client`
  requests only the `.default` scope (correct and required for app-only
  client-credentials flow — individual scopes aren't requestable that way;
  the actual grant is whatever's configured on the Entra app registration
  per ADR-0003, `Files.Read.All` + `Sites.Read.All`). Confirmed zero write
  HTTP verbs anywhere in the package. **Deployment-time check, not
  verifiable from code**: confirm the Entra app registration's configured
  API permissions match ADR-0003 exactly when provisioning each
  environment — code can't enforce what a tenant admin actually consented
  to.
- **ADR-0014 enforcement**: the collector's site query
  (`sharePointSites.findMany({ where: { microsoftTenantId, status:
  'Approved' } })`) is the single, tested chokepoint — a site can never be
  scanned without that exact status, verified directly by
  `document-collector.processor.spec.ts`.

### 3. Data integrity — 2 real gaps found and fixed

- **Document reconciliation (fixed)**: the collector never marked a
  `Document` `Removed` when it disappeared from SharePoint — it would stay
  `Active` and keep being scored forever. ADR-0007's domain model table
  already specified this exact lifecycle transition ("`Active` → `Removed`
  ... when a rescan no longer finds the item in SharePoint") but it was
  never implemented. Fixed: after a site's enumeration completes
  successfully, any previously-`Active` document for that site not seen in
  this run is marked `Removed`. Reconciliation only runs on a *complete*
  enumeration — a partial/failed one never marks anything Removed, since an
  incomplete picture can't distinguish "deleted" from "we didn't get that
  far." `GET .../document-health` now excludes `Removed` documents (a
  deleted file shouldn't show a stale "current" health score); `GET
  .../documents` still returns them with their status visible, which is
  correct for an audit/history view.
- **Concurrent scans of the same tenant (fixed)**: `Document` upsert is
  find-then-write, not an atomic upsert — two overlapping scans of the same
  `MicrosoftTenant` could race on the same rows. Nothing previously
  prevented triggering a second scan while one was already in flight.
  Fixed: `POST .../scans` now returns 409 if a `ScanJob` for that tenant is
  already `Queued` or `Running`. This substantially narrows the race
  (residual risk documented below, not eliminated).
- **Verified correct, no change needed**: `HealthScore` update behavior
  (each scan writes a new immutable row, `Document.currentHealthScoreId`
  repointed to the newest — intentional, this is the historical-trend data
  ADR-0004 anticipates) and `HealthIssue` cleanup (issues are 1:1 with an
  immutable `HealthScore`, never orphaned, never need independent cleanup).
  Document uniqueness (`@@unique([siteId, graphItemId])`) makes re-scanning
  idempotent at the row level.

### 4. Operational readiness — 4 real gaps found and fixed

- **No log line for failed Graph calls (fixed)**: a site enumeration
  failure was recorded on the `ScanJob` row but never logged — no trace in
  application/container logs unless someone queried the job. Added
  `logger.error` at both the site-enumeration failure point and (new) at
  the per-document failure point.
- **One bad document aborted the rest of its site (fixed)**: `upsertDocument`
  wasn't individually try/caught — one item throwing (e.g., a transient
  constraint error) aborted the async generator and silently skipped every
  remaining document in that site/drive, miscounted as a single generic
  "site failure." Fixed: each item's persist is now isolated; failures are
  counted and logged per-item, and the loop continues.
- **No queue retry policy (fixed)**: `BullModule.registerQueue` had no
  `defaultJobOptions` — BullMQ's default is `attempts: 1`, so any
  unhandled exception (Redis blip, DB connection drop) failed the job
  permanently with no automatic recovery. Added `attempts: 3` with
  exponential backoff; safe because whole-job retry is idempotent (see
  Data Integrity above).
- **Worker failures invisible beyond Redis (fixed)**: no `@OnWorkerEvent`
  handlers existed, so a job that exhausted its retries or crashed the
  worker process left zero application-level log trace. Added `'failed'`
  and `'error'` handlers, both logging via `Logger.error`.
- **`WORKER_CONCURRENCY` was dead config (fixed)**: declared in
  `.env.example` since an earlier phase, never actually read anywhere.
  Now wired to `@Processor`'s `concurrency` option (falls back to `5`).

### 5. Documentation — this doc, plus:

- ADR-0004 amended with the retry/concurrency/overlapping-scan/reconciliation
  decisions above (2026-07-12 amendment section).
- Known limitations consolidated below.

## Known limitations (carried forward, not fixed in this review)

These are real, intentional scope boundaries — not oversights — each with a
documented reason:

1. **`hasReviewDate` is always `false`.** Graph's driveItem endpoint has no
   native "review date" — that's a SharePoint custom list column, requiring
   the separate List Items API (`/sites/{id}/lists/{id}/items?expand=fields`),
   out of `packages/graph-client`'s ADR-0013-reviewed scope. Every document
   currently reports a ReviewStatus issue until this is built.
2. **No recursive folder traversal.** `listDocuments` enumerates only a
   drive's root-level children; documents inside subfolders are not yet
   discovered. `GraphDriveItem` doesn't yet expose enough to recurse
   correctly at scale (would need per-folder `children` calls).
3. **Duplicate detection is exact-match only** (`name` + `sizeBytes` within
   a tenant) — per ADR-0005's decided MVP scope, not fuzzy/content-based.
4. **`packages/config`'s validated env schema (`parseEnv`) is never called
   at either app's boot** — pre-existing gap, predates Phase 5. A missing
   or malformed `ENTRA_CLIENT_SECRET` (or any other required var) currently
   fails deep inside MSAL token acquisition with a confusing error instead
   of failing fast at startup with a clear message. **Recommended fix**
   (not applied in this review — cross-cutting change to both apps'
   bootstrap, outside the Document Collector's own boundary): call
   `parseEnv(process.env)` at the top of each `main.ts`, before
   `NestFactory.create`, and let it throw.
5. **Residual concurrency race in `Document` upsert.** The new "one scan
   per tenant at a time" guard (see Data Integrity) closes the common case,
   but it's a check-then-act guard, not a database constraint — two
   `triggerScan` calls within the same race window could theoretically both
   pass the check. A true fix would need an atomic upsert (`ON CONFLICT`)
   in the repository layer, which none of the repositories currently expose
   generically.
6. **Redis network exposure is an infra/deployment concern, not a code
   one.** ADR-0006 specifies Azure Cache for Redis Standard tier but
   doesn't explicitly document private/VNet-only access as a decision.
   Since a compromised or misconfigured public Redis endpoint would
   undermine the "worker only processes jobs from validated triggers"
   security property, confirm private network access as part of
   provisioning each environment.

## Migration rollback considerations

No automatic rollback tooling exists (`prisma migrate deploy` is
forward-only); the notes below are what a manual rollback of each migration
would require, for incident response.

- **`20260711185029_init_domain_model`**: initial schema. Rollback = drop
  every table/enum created here, i.e., the whole domain model. Only
  relevant before any real customer data exists; after that, "rollback"
  means a new forward migration, not reversing this one.
- **`20260711201802_add_user_microsoft_tenant_link`**: adds a `NOT NULL`
  column (`User.microsoftTenantId`) with no default. Forward-only in
  practice once any `User` rows exist — an `ALTER TABLE ... ADD COLUMN ...
  NOT NULL` with no default requires every existing row to already have a
  value, meaning this migration could only have been applied against an
  empty or already-backfilled `User` table. Reverting would require
  dropping the column and its FK/unique index — safe, but loses the
  tenant-link data.
- **`20260711212300_add_user_pending_approval_status`**: `ALTER TYPE
  "UserStatus" ADD VALUE 'PendingApproval'`. **Not cleanly reversible.**
  Postgres cannot drop a single enum value (no `DROP VALUE`) — the only way
  to remove it is recreating the enum type from scratch and remapping every
  dependent column, which is a real migration in its own right, not a
  rollback. If this needs reverting, first confirm zero `User` rows
  actually use `PendingApproval` (`ALTER TYPE` additions can't be
  conditionally undone).
- **`20260712091612_add_sharepoint_site_status`**: additive only (new enum
  type, three new nullable/defaulted columns, one FK with `ON DELETE SET
  NULL`, one index). Cleanly reversible: drop the FK, drop the three
  columns, drop the index, drop the `SharePointSiteStatus` enum. No data
  loss beyond the site-approval state itself.

**General rule going forward**: prefer additive, nullable-or-defaulted
columns and avoid `ALTER TYPE ... ADD VALUE` where a lookup table would do,
specifically because enum values can't be removed later without a full type
rebuild.
