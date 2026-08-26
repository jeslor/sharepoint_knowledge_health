# ADR-0022: Bulk Remediation Job Architecture

Date: 2026-08-13
Status: Accepted — implementation-ready as of the 2026-08-21 addendum (§13). No code has been written yet; Phase 3A-2 implements §3/§6 (as amended by §13.1), Phase 3A-3 implements §7.

---

## 1. Problem Statement

The product can detect a governance problem (a `HealthIssue`/`GovernanceIssue`
of a given type on many documents) but offers no way to fix many of them at
once. Today an Admin/GovernanceManager must open each document individually
and, for review dates, manually type a value per document — no bulk
operation, no background processing, no per-item progress or retry. The
first concrete case: "37 documents are missing a review date; let an admin
set one value once and apply it to all of them."

## 2. Current Limitation

Confirmed via direct inspection, not assumed: **no per-item/sub-operation
tracking pattern exists anywhere in this codebase today.**
`document-collector.processor.ts`'s per-document persist loop catches
per-item failures but only ever feeds an aggregate `documentsFailed` int
column and a `errorSummary` string truncated to the first 20 error
messages (`errors.slice(0, 20).join('; ')`) — there is no way today to know
*which* document failed, why, or to retry just it.
`StaleScanRecoveryService`'s crash recovery is whole-job-only: it flips an
entire `ScanJob` to `Failed` past a 2-hour threshold, with zero per-item
memory of what had already succeeded. This aggregate-only model is
confirmed insufficient for "44 of 47 succeeded, retry the 3 that failed."

Separately confirmed: `@sph/graph-client` has zero write functions (ADR-0013),
and Graph auth is entirely app-only (`acquireTokenByClientCredential`, one
shared `ConfidentialClientApplication`) — there is no per-user delegated
Graph token anywhere in this system. Both facts shape §3.5/§8 below.

## 3. Decision

### 3.1 `RemediationJob` / `RemediationItem` — the only new schema this ADR introduces

One `RemediationJob` row per bulk operation; one `RemediationItem` row per
targeted document. See §6 for the full proposed shape. Justified precisely
because §2 confirms nothing today can represent per-item state — not a
speculative addition.

`RemediationJob.issueType` reuses the existing `HealthIssueCriterion` enum
as its key (no parallel taxonomy invented) — Phase 3A-2 only ever
populates it with `'ReviewStatus'`, but the column itself is not
review-date-specific.

### 3.2 A narrow strategy interface, not a generic workflow engine

Mirrors a shape this codebase already uses elsewhere: `calculate-score.ts`
composes 6 independent, isolated per-criterion rule modules
(`rules/review-status.ts`, `rules/ownership.ts`, etc.) behind one
composition function. Remediation actions follow the same shape — a
minimal interface (`execute(context, document, payload) → Result`), one
small module per action type. Phase 3A-2 implements exactly one:
`SetReviewDateAction`. A second action type (e.g. `AssignOwnerAction`) is
explicitly **not** built until `SetReviewDate` is proven in production
against a real tenant — see ADR-0013's amendment and the Live-Tenant
Validation plan referenced in §12.

Because a remediation action inherently needs Graph-write and database
access, it cannot be a pure function in a `@sph/*` package the way
`review-date-discovery`/`scoring` are (both explicitly forbid
`@sph/database` and any I/O via their own `no-restricted-imports` rules).
Action implementations live directly in `apps/worker`, mirroring exactly
how `review-date-sync.ts` is already structured (a shared discovery
package + worker-owned orchestration). Only the job/item status *shapes*
are shared, via `@sph/types`.

### 3.3 `REMEDIATION_QUEUE` — a new BullMQ queue, following `SCAN_QUEUE`'s existing shape with one deliberate difference

Registered the same way `SCAN_QUEUE` is (`apps/worker/src/queue/queue.module.ts`),
with the same `defaultJobOptions` shape (`attempts`, exponential backoff)
as a starting point for catastrophic whole-worker-crash retry. **The
critical difference**: `SCAN_QUEUE`'s retry re-runs the entire job from
scratch (confirmed: no per-item checkpointing exists). A remediation job
must not blindly re-attempt already-succeeded writes. On every
attempt/resume, the processor reads current `RemediationItem` statuses
from Postgres first and only acts on `Pending`/retryable-`Failed` items —
"Postgres is the durable source of truth, the queue is just a trigger,"
the same philosophy ADR-0015 §1 already established for scheduling.

Job payload: `{ organizationId: string, remediationJobId: string }` —
nothing else, mirroring `ScanJobPayload`'s exact shape. The worker never
re-derives who initiated the job, what role they had, or which documents
are targeted from anything except this payload plus the `RemediationJob`/
`RemediationItem` rows it points to — everything needed was captured and
persisted at job-creation time, inside the authenticated HTTP request
where `RolesGuard`/`OrganizationAccessGuard` already ran. See §8.

**Bounded, in-job concurrency is a new design surface**, not reused from
`SCAN_QUEUE` (whose `concurrency` setting is job-level — how many *scans*
run in parallel — not sub-item-level). A remediation job writing to many
documents needs its own bounded concurrency *within* one job to manage
Graph-throttling risk. A dedicated `REMEDIATION_WORKER_CONCURRENCY` env
var (not shared with `WORKER_CONCURRENCY`) is proposed, exact default to
be set during Phase 3A-2 implementation based on the SDK's documented
retry/backoff bounds (ADR-0013 §3: 3 retries, 3s base, 180s cap).

### 3.4 Verification model — targeted, not a full rescan

After a successful write, the item is verified by a **targeted re-fetch
and re-score of just that one document** — reusing the exact Graph
read machinery already built in Phase 1 (`listItemFields`) and
`calculateScore`'s existing per-document call shape — not by triggering a
new `ScanJob`. `ScanJob` today is whole-tenant/whole-site oriented;
forcing a full rescan to verify one field's write on N documents would be
slow and would require inventing a "partial scan" concept this codebase
doesn't have. An item is marked `Succeeded` only after this verification
confirms the fresh value matches what was written — never merely because
the Graph PATCH call itself returned success.

### 3.5 Governance resolution — new capability, narrowly scoped

Confirmed via direct inspection: **no auto-resolution mechanism exists
anywhere in this codebase today.** `stillDetected`
(`governance-issues.service.ts`) is a read-time, display-only derived
flag; every `GovernanceIssue` resolution today is a human explicitly
calling the update endpoint. This is genuinely new behavior, not a reuse
of something that already exists — scoped as narrowly as possible:

- After an item's write is verified (§3.4) and the underlying
  `HealthIssue` for that criterion is confirmed gone, the worker performs
  the *exact same* `status`/`resolvedAt` transition
  `GovernanceIssuesService.updateIssue` already writes for a human-driven
  resolution — no new status value, no new transition shape.
- **Attribution: the user who initiated the remediation job** — captured
  on `RemediationJob` at creation time, never a synthetic "system" actor.
  This decision was made explicitly because `GovernanceActivity.actorUserId`
  is a required FK (`onDelete: Restrict`) with no existing precedent for a
  system actor on this model (unlike `AuditLog.actorUserId`, which is
  nullable and reserved for exactly this kind of case but unused so far).
  Attributing to the initiating user avoids a schema change and is
  arguably more meaningful: "resolved as a consequence of Jane's bulk
  action" is real information, not a fiction.
- Scoped strictly to the exact case verified fixed by the exact
  remediation that ran — never a general "auto-resolve anything that
  looks fixed" sweep, which would be a materially larger, riskier feature
  than what this ADR proposes.

### 3.6 Audit and notification integration — reuses existing patterns, adds no new mechanism

```
User initiates bulk remediation (authenticated HTTP request)
  → ONE AuditLog row: action 'remediation_job.initiated',
    targetType 'RemediationJob', actorUserId = the real user,
    metadata = {issueType, targetCount}
    (aggregate — matches AuditLog's existing convention of one row per
    privileged action, never per affected entity, e.g. site approval)
  → RemediationJob + N RemediationItem rows created
  → REMEDIATION_QUEUE job enqueued
       ↓
Worker, per document: write → verify (§3.4) → if the HealthIssue is
  now gone: GovernanceIssue → Resolved (§3.5) + ONE GovernanceActivity
  row per document, type 'IssueResolved' (already exists in the enum —
  no new activity type needed), actorUserId = the initiating user
       ↓
Job completion → enqueue the SAME notification-reconciliation job the
  scan pipeline already triggers
  (`this.reconciliationQueue.add('reconcile-org', ...)`, confirmed to
  already exist in `document-collector.processor.ts`) — zero new
  notification code
```

`AuditLogAction`/`AuditLogTargetType` gain new union members
(`'remediation_job.initiated'`, `'RemediationJob'`) — confirmed these are
plain TypeScript string unions over plain `String` Prisma columns, so this
is an application-layer change only, no migration.

## 4. What can be reused (no changes required)

- `ScanJobPayload`'s `{organizationId, X}` shape and the
  `createTenantContext(organizationId)` pattern.
- `@sph/graph-client`'s existing error hierarchy
  (`GraphPermissionError`/`GraphNotFoundError`/`GraphThrottledError`/
  `GraphTransientError`) for per-item failure classification — no new
  error taxonomy.
- The Graph SDK's own `RetryHandler` middleware (ADR-0013 §3) for
  throttling — already applies uniformly to `PATCH`, confirmed verb-
  agnostic; no bespoke Retry-After handling needed in this codebase.
- `GovernanceIssue`'s existing status machine, `ALLOWED_TRANSITIONS`
  shape, and `GovernanceActivityType.IssueResolved` (already exists in
  the enum).
- The existing notification-reconciliation pipeline, unchanged, wholesale.
- `BulkActionToolbar` (`apps/web/src/components/ui/bulk-action-toolbar.tsx`)
  — a real, generic, currently-unused UI shell (confirmed zero existing
  consumers) — for Phase 3A-3's selection UI.
- `useApiQuery`'s existing `pollIntervalMs` option (confirmed present but
  unused — the scans page hand-rolls its own `setInterval` instead) — for
  Phase 3A-3's progress polling.

## 5. Minimum viable implementation

Phase 3A-2 implements exactly: `updateListItemFields` (ADR-0013's
amendment), `RemediationJob`/`RemediationItem` (§6), `REMEDIATION_QUEUE`
+ processor, `SetReviewDateAction` only, the resolve/audit/notification
wiring in §3.5/§3.6. Phase 3A-3 implements the UI (§7, detailed in the
Phase 3 proposal, not repeated here). No second action type, no `$batch`,
no ETag/optimistic-concurrency conflict detection — all explicitly
deferred (§9).

## 6. Data Model Proposal

```prisma
enum RemediationJobStatus {
  Running
  Completed   // terminal — all items reached a terminal state (Succeeded/Failed/Skipped)
}

enum RemediationItemStatus {
  Pending
  Succeeded
  Failed
  Skipped   // e.g. the document was deleted/moved before the job reached it
}

model RemediationJob {
  id                 String                @id @default(cuid())
  organizationId     String
  issueType          HealthIssueCriterion  // reuses the existing enum; Phase 3A-2 only ever writes 'ReviewStatus'
  payload            Json                  // e.g. { "nextReviewDueAt": "2026-09-30T00:00:00.000Z" }
  status             RemediationJobStatus  @default(Running)
  initiatedByUserId  String
  initiatedByRole    UserRole              // captured at creation — the worker never re-derives authorization from request state
  totalCount         Int
  succeededCount     Int                   @default(0)
  failedCount        Int                   @default(0)
  createdAt          DateTime              @default(now())
  completedAt        DateTime?

  organization      Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  initiatedByUser    User               @relation(fields: [initiatedByUserId], references: [id], onDelete: Restrict)
  items              RemediationItem[]

  @@index([organizationId, status])
}

model RemediationItem {
  id                 String                  @id @default(cuid())
  organizationId     String                  // see §13.1 — added by the 2026-08-21 addendum
  remediationJobId   String
  documentId         String
  status             RemediationItemStatus   @default(Pending)
  errorType          String?                 // e.g. "GraphPermissionError" — mirrors the graph-client error class name, no new taxonomy
  errorMessage       String?
  attemptCount       Int                     @default(0)
  updatedAt          DateTime                @updatedAt

  organization   Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  remediationJob RemediationJob @relation(fields: [remediationJobId], references: [id], onDelete: Cascade)
  document       Document       @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@unique([remediationJobId, documentId])
  @@index([organizationId, status])
  @@index([remediationJobId, status])
}
```

**Corrected by §13.1 (2026-08-21)** — `organizationId` is now on
`RemediationItem` directly, not only on `RemediationJob`. The original
reasoning above ("matches `HealthIssue`/`HealthScore`'s existing
precedent of scoping the parent, not every child row") was factually
wrong about this repository's actual schema: direct inspection confirms
`HealthIssue`, `HealthScore`, `GovernanceIssue`, `SharePointReviewDateMapping`,
and `ScanJob` **all** carry their own `organizationId` column, with zero
exceptions — there is no existing precedent anywhere in this schema for
parent-only scoping. See §13.1 for the full correction and rationale.

**Exact field names/types above are a proposal, not frozen** — Phase 3A-2
implementation may adjust naming to match conventions discovered during
that work, but the two-table shape and the fields needed to support
progress/partial-failure/retry/crash-recovery/idempotent-resume (§9) are
the load-bearing part of this decision.

## 7. UX Proposal

Full detail in the Phase 3 architecture proposal (§N, "UI/UX proposal");
implemented in Phase 3A-3, not repeated here. Summary: select (via
`BulkActionToolbar`) → confirm (target count, value, SharePoint-managed
status, ineligible documents) → submit → poll progress (via `useApiQuery`'s
`pollIntervalMs`) → results (succeeded/failed counts, view failures, retry
failed). **Maximum selection size: 500 documents per job** — not a
backend limitation (Postgres/BullMQ handle far more without issue), but
because a single unbounded job makes progress/retry UX unwieldy and
Graph-throttling risk harder to reason about at MVP scale. A selection
over the limit must be explained clearly, not silently truncated.

## 8. Tenant isolation & authorization

- `RemediationJob`/`RemediationItem` are read/written exclusively through
  `createTenantContext(organizationId)`, matching every other model.
- The job payload (`{organizationId, remediationJobId}`) never lets the
  worker re-derive *who* initiated the job or *what* they're allowed to
  do from anything except what was persisted at creation time, inside the
  authenticated HTTP request where `RolesGuard`/`OrganizationAccessGuard`
  already ran — directly satisfying the requirement that a queued
  background job's authorization must never depend on the originating
  HTTP request continuing to exist.
- **Server-side re-validation is mandatory at job-creation time**: the
  endpoint that creates a `RemediationJob` must confirm every
  client-supplied `documentId` actually belongs to the requesting
  organization (and is currently eligible for the requested action)
  before persisting any `RemediationItem` row — never trust client-
  supplied ids blindly. Mirrors a pattern already used twice elsewhere in
  this codebase (`selectConfirmCandidate`'s re-validation against live
  candidates in `sharepoint-metadata.service.ts`; assignee validation in
  `governance-issues.service.ts`).
- **Knowledge Health authorization**: reuses `RolesGuard`/
  `@Roles('Admin', 'GovernanceManager')` exactly as `confirmReviewDateMapping`
  already does — no new role.
- **SharePoint authorization**: because Graph auth is entirely app-only
  (confirmed — no per-user delegated token exists anywhere in this
  system), there is no per-user SharePoint permission to check. The only
  relevant fact is org-level and binary: has this organization's app
  registration been granted `Sites.ReadWrite.All` (ADR-0003's amendment).
  No pre-flight check is introduced (ADR-0003's amendment §"No pre-flight
  permission probe") — a 403 on the first real write is the check,
  surfaced as one per-item failure (§9).

## 9. Partial failure and retry model

- `RemediationItem.status`: `Pending | Succeeded | Failed | Skipped`.
- `errorType` reuses `@sph/graph-client`'s existing typed error class
  names directly: `GraphThrottledError`/`GraphTransientError` →
  retryable; `GraphPermissionError`/`GraphNotFoundError` → permanent (a
  deleted/moved/inaccessible document surfaces as exactly these — no
  special pre-check needed, consistent with §8's "no pre-flight probe").
- **"Retry failed" re-runs the same `RemediationJob`**, not a new,
  parallel "retry job" concept — since the processor is already required
  to be resume-capable (§3.3: skip `Succeeded` items on any re-attempt),
  retrying is just re-invoking that same idempotent-resume logic. One
  code path, not two.
- **Worker-crash survival is a real improvement over `StaleScanRecoveryService`'s
  existing model**, enabled specifically by per-item state existing here
  where it doesn't for `ScanJob`: a stale-recovery pass for
  `RemediationJob` can re-enqueue only the still-`Pending` items, leaving
  already-`Succeeded` writes untouched — strictly better than `ScanJob`'s
  current all-or-nothing recovery.
- **Idempotency**: PATCHing a field to a value is naturally idempotent — a
  retried write is safe to simply repeat. This is a genuine, worth-stating
  advantage of choosing "set a date field" as the first remediation
  action: it's about the safest possible kind of write to build this
  whole pattern around.
- **Stale SharePoint state** (someone else edits the column between
  eligibility-check and the bulk write): explicitly accepted as a
  documented v1 risk, not solved with ETag/optimistic-concurrency
  detection in Phase 3A-2 (per the explicit non-goal) — a genuinely
  concurrent edit could be silently overwritten by the bulk write. This
  matches this codebase's own demonstrated pattern of flagging and
  accepting a narrow, understood risk rather than over-building (e.g. the
  documented, accepted `Promise.race`-doesn't-cancel-the-loser risk from
  the F2 LAT fix).

No schema beyond §6's two tables is needed to represent any of the above.

## 10. Risks

- **Write-path bugs are categorically higher-stakes than anything else
  built in this feature's history** — a bad write can mutate a real
  customer's SharePoint data, unlike a bad read, which only shows wrong
  data. Mitigated by the Live-Tenant Validation plan (referenced in §12)
  being non-negotiable before this is considered production-ready, and by
  choosing the single safest possible first write.
- **`RemediationItem` is the one place this ADR asks for new schema
  trust** — mitigated by its minimal, precedented shape (mirrors
  `ScanJob`/`GovernanceIssue` conventions already in the schema).
- **Auto-resolving `GovernanceIssue` is new system-initiated-mutation
  territory** — mitigated by attributing to the real initiating user and
  scoping strictly to the exact verified-fixed case (§3.5).
- **Bounded in-job concurrency + no `$batch` sets a real write-throughput
  ceiling** — acceptable at current scale; revisit only if real usage
  proves it insufficient, not preemptively.
- ~~The re-consent UX for `Sites.ReadWrite.All` is not yet designed
  (ADR-0003's amendment, explicitly deferred as a Phase 3A-2
  prerequisite) — implementation of §3/§6 above must not begin until that
  investigation resolves.~~ **Resolved (2026-08-21) — see §13.** ADR-0023
  investigated this live against a real tenant, designed, implemented,
  reviewed, and end-to-end-validated the re-consent detection/entry-point
  mechanism. This is no longer a blocker for Phase 3A-2.

## 11. ADRs Requiring Amendment

- **ADR-0013** — amended (2026-08-13): the one narrow `updateListItemFields`
  write function.
- **ADR-0003** — amended (2026-08-13): the `Sites.ReadWrite.All` scope
  decision, backward-compatibility requirement, and the deferred
  re-consent-UX prerequisite.
- **ADR-0016** — addended (2026-08-13, §17.4/§17.5): the manual-write
  conflict guard, and a cross-reference to this ADR's resolution
  mechanism. **Not yet further amended (2026-08-21)**: §13.2 below
  documents a narrow, explicitly-scoped exception to ADR-0016 §16.1's
  "a worker process must never mutate `GovernanceIssue` lifecycle
  state... under any circumstance" rule, required for automated
  remediation resolution. This exception is recorded here, in this ADR,
  per explicit direction not to edit ADR-0016's own file as part of this
  addendum — but a future formal amendment to ADR-0016 §16.1 (mirroring
  its own existing §16 amendment structure) would be the more durable
  home for it and is worth doing before or during implementation.
- **ADR-0002** — amended (2026-08-13): the Missing/Overdue/Healthy/Due-Soon
  scoring change this ADR's verification step (§3.4) depends on to know
  whether an issue is "actually gone."
- **ADR-0023** — not amended, referenced only. Fully implemented,
  reviewed, and live-validated (2026-08-21) — resolves the re-consent-UX
  prerequisite this ADR's §10 previously named as blocking. See §13.5.

## 12. Non-Goals (Phase 3A-2/3A-3)

Automatic SharePoint column creation. A generic, config-driven workflow
engine. Graph `$batch` request batching. ETag/optimistic-concurrency write
protection. A second remediation action type until `SetReviewDate` is
proven via live-tenant validation. Unbounded bulk selection size.
LLM/AI-based column matching (unrelated to this ADR directly, but
reaffirmed here since it's adjacent territory — see ADR-0016 §17.2's
existing confidence-scoring decision, unchanged by this ADR). The
Live-Tenant Validation checklist itself lives in the Phase 3 architecture
proposal (chat record, 2026-08-13) and `docs/testing/` conventions, not
duplicated in this ADR. **Added by the 2026-08-21 addendum (§13.5)**:
cross-job duplicate/overlap detection — no distributed document lock, no
cross-job locking mechanism; the write's own idempotency (§9) already
makes concurrent/overlapping jobs targeting the same document safe.

## 13. Implementation Clarifications / Addendum (2026-08-21)

A focused implementation-readiness investigation (source-level, against
this repository's actual state — not assumption from this ADR's own
text) found five genuine open decisions this ADR had not addressed, plus
confirmed that ADR-0023 has fully closed the one prerequisite §10 named
as blocking. This addendum resolves all five. Every other decision this
ADR already made (§1-§12) stands unchanged except where a specific
correction is called out below and cross-referenced from its original
section.

### 13.1 `RemediationItem.organizationId`

**Decision**: `RemediationItem` gets its own `organizationId` column,
directly, in addition to `RemediationJob.organizationId`. §6's schema
block above has been updated in place to reflect this (a corrected
`organization` relation, and `@@index([organizationId, status])` added
alongside the existing `@@index([remediationJobId, status])`).
`RemediationItem` remains linked to its parent via `remediationJobId`,
and `@@unique([remediationJobId, documentId])` is unchanged.

**Rationale**: §6's original text justified the omission by claiming it
"matches `HealthIssue`/`HealthScore`'s existing precedent of scoping the
parent, not every child row." Direct inspection of the actual schema
during this investigation found that claim to be incorrect —
`HealthIssue`, `HealthScore`, `GovernanceIssue`,
`SharePointReviewDateMapping`, and `ScanJob` all carry their own
`organizationId` column, with **zero exceptions** anywhere in this
schema. Every existing tenant-scoped repository (`packages/database/src/repositories/*`)
does flat, column-based `WHERE organizationId = ...` scoping, constructor-injected
once and merged into every query — none of them scope through a parent
relation. Omitting `organizationId` from `RemediationItem` would have
made it the first model in this entire codebase to require join-based
tenant isolation, a genuinely new pattern with no precedent to build on
or test against.

**Implementation constraint**: `RemediationItemRepository` must follow
the exact same shape as every other tenant-scoped repository in
`packages/database/src/repositories/` (constructor-injected
`organizationId`, merged into every `WHERE` clause) — no special-casing.
The existing `tenant-isolation.spec.ts` sweep gains two new entries
(`RemediationJobRepository`, `RemediationItemRepository`) using its
existing structure, unchanged.

### 13.2 `GovernanceIssue` `Open → Resolved` — an explicit, narrow automated-resolution path

**Decision**: bulk remediation does **not** perform a synthetic
`Open → InProgress → Resolved` double-hop through the existing,
human-facing `GovernanceIssuesService.updateIssue`/`ALLOWED_TRANSITIONS`
path. That would write two `GovernanceActivity` rows (`StatusChanged`
then `IssueResolved`) for one automated action, misrepresenting what
actually happened. Instead, this ADR introduces a **separate, narrow,
worker-callable resolution function**, living in `packages/database`
(alongside the other tenant-scoped write helpers `apps/worker` already
calls directly for `HealthScore`/`HealthIssue`, per this codebase's
established `apps/api`-and-`apps/worker`-never-call-each-other boundary,
ADR-0009) — not a new HTTP call from worker to API, and not a change to
`GovernanceIssuesService.updateIssue` or `ALLOWED_TRANSITIONS` itself.

This function:
- accepts an `Open` **or** `InProgress` `GovernanceIssue` and transitions
  it directly to `Resolved` — a transition `ALLOWED_TRANSITIONS`
  (`governance-issues.service.ts`) does not permit for the human-facing,
  HTTP-guarded path, and this addendum does not change that map;
- is only ever invoked after `SetReviewDateAction`'s write has been
  verified (§3.4) **and** the underlying `HealthIssue` for that criterion
  is confirmed gone — never speculatively;
- writes exactly one `GovernanceActivity` row, type `IssueResolved`
  (already an existing enum value — confirmed present, no schema change
  needed), `actorUserId` set to `RemediationJob.initiatedByUserId` — the
  same real, already-role-checked user §8 already establishes as the
  worker's sole source of "who authorized this," never a synthetic actor;
- sets `resolvedAt` the same way `updateIssue` already does for a
  human-driven `Resolved` transition — `new Date()` at the moment of
  transition, no special-casing;
- is scoped through `createTenantContext(organizationId)` exactly like
  every other write in this system — tenant isolation is never bypassed;
- has **no HTTP-facing authorization check of its own**, and does not
  need one: authorization already happened once, at `RemediationJob`
  creation time, inside the authenticated request where
  `RolesGuard`/`OrganizationAccessGuard` ran (§8, unchanged) — this
  function only ever executes a decision already authorized then, the
  same principle §8 already states for the write path generally.

**This is a narrow, explicitly-scoped exception, not a general weakening
of `ALLOWED_TRANSITIONS`.** The human-facing HTTP path
(`PATCH .../issues/:issueId`) is completely unchanged — a human still
cannot skip `InProgress`, still cannot resolve an issue that isn't
theirs without the appropriate role, still goes through
`assertUpdateAuthorized`/`ALLOWED_TRANSITIONS` exactly as before. Only
this one, narrowly-scoped, worker-internal function gains the ability to
jump `Open → Resolved`, and only under the three preconditions above
(verified write, confirmed-gone `HealthIssue`, a `RemediationJob`-derived
actor).

**Relationship to ADR-0016 §16.1**: that section states, in the course of
narrowing the worker's *read* boundary, that the worker's *write*
prohibition on `GovernanceIssue` ("must never mutate... under any
circumstance") is "unchanged and still absolute." This addendum is a
second, equally narrow exception to that same absolute rule — reasoned
the same way ADR-0021 reasoned its read exception: the original rule's
actual load-bearing guarantee is that `GovernanceIssue` stays
trustworthy and not silently mutated by scan-time logic; a purpose-built,
narrowly-scoped, three-precondition-gated resolution function invoked
only from the remediation pipeline (never `DocumentCollectorProcessor`,
never any other worker code path) preserves that guarantee's actual
intent while adding the one capability this feature genuinely needs. Per
explicit direction, ADR-0016's own file is not edited by this addendum —
see §11's updated entry above for the forward-reference and the
recommendation that a future formal ADR-0016 amendment (mirroring its
existing §16 structure) would be the more durable home for this.

### 13.3 Write succeeded, verification failed

**Decision**: no new `RemediationItemStatus` value. If a `SetReviewDateAction`
write (the Graph `PATCH`) succeeds, but the subsequent targeted re-fetch
(§3.4) does not confirm the expected value, the item **stays `Pending`**
— it is not marked `Failed`, and it is never marked `Succeeded` without
confirmation.

**Rationale**: the write itself is idempotent (§9, unchanged) — a retried
`PATCH` is always safe to repeat. A `Pending` item is exactly "work that
has not yet reached a verified terminal state," which is precisely what
this scenario is. Marking it `Failed` would be actively wrong (the write
plausibly succeeded) and would require a human to notice and retry
something the system could safely retry itself; marking it `Succeeded`
without confirmation would directly violate §3.4's own rule ("An item is
marked `Succeeded` only after this verification confirms the fresh value
matches what was written — never merely because the Graph PATCH call
itself returned success").

**One necessary distinction, so this doesn't silently expand the status
model's meaning**: this `Pending`-on-ambiguous-mismatch case is different
from a **verification call that itself fails with a real, classifiable
Graph error** (e.g. the re-fetch returns `GraphNotFoundError` because the
document was deleted moments after the write succeeded, or
`GraphThrottledError`/`GraphTransientError` during the re-fetch itself).
Those go through the exact same classification §9 already defines for
the write call — `GraphNotFoundError`/`GraphPermissionError` → `Failed`
with the matching `errorType`; `GraphThrottledError`/`GraphTransientError`
→ stays `Pending`, retried. The **only** new case this decision covers is
"the write returned success, the re-fetch returned success, but the
returned value doesn't match what was written" — an ambiguous mismatch
with no Graph error at all, which is the one case §9's existing
error-type-based classification has nothing to say about.

**Implementation constraint**: governance resolution (§13.2) is gated
strictly on `Succeeded`, never on `Pending` — an item stuck in this
ambiguous-mismatch state can never trigger a `GovernanceIssue`
resolution, no matter how many retries it accumulates, until a retry
actually confirms the value.

### 13.4 DriveItem ID vs. SharePoint list item ID — corrected (2026-08-22)

**This section was factually wrong when first written and is corrected
here, before any code was written against it.** The original text assumed
`updateListItemFields` would use the site/list-based Graph endpoint
(`/sites/{siteId}/lists/{listId}/items/{itemId}/fields`, keyed on a
distinct SharePoint list-item ID) and proposed resolving that list-item
ID via `review-date-sync.ts`'s existing `listItemFields`/`listItemDriveItemIds`
join. That endpoint choice was never actually decided anywhere — it
conflicted with `docs/decisions/0013-microsoft-graph-client-architecture.md`'s
own 2026-08-13 amendment, which had **already** specified
`updateListItemFields` as the **drive-based** endpoint:

```typescript
function updateListItemFields(
  entraTenantId: string,
  driveId: string,
  itemId: string,
  fields: Record<string, string>,
  options?: ListOptions,
): Promise<void>;
```

mapping to `PATCH /drives/{driveId}/items/{itemId}/listItem/fields`. This
was caught and reconciled before Phase 1 implementation began, in favor
of ADR-0013's already-accepted, more specific decision — ADR-0013 is the
ADR that actually authorizes and defines this function; ADR-0022 is a
consumer of that capability and must not redefine it.

**Decision (corrected)**: `Document.graphItemId` — already persisted,
already known for every document — **is** the `itemId` this endpoint
needs. There is no separate SharePoint list-item ID to resolve for the
write itself; §13.4's original premise (a list-item-ID lookup) does not
apply to the write path at all. **The real, remaining resolution
problem is narrower and different**: obtaining the `driveId` for a given
`Document`. `document-collector.processor.ts`'s `upsertDocument` knows
`drive.id` at scan time but only ever persists `graphListId`
(`drive.list?.id`) onto `Document` — `driveId` itself is not stored
anywhere today.

**Resolve `driveId` at remediation execution time, not by adding a new
persisted field**: call the existing `listDrives(entraTenantId, site.graphSiteId)`
(already in `packages/graph-client`, unchanged) and match the drive whose
`list?.id === document.graphListId` — the same site-scoped drive
enumeration `document-collector.processor.ts` already performs at scan
time, just re-run at remediation time for the one drive a targeted
document belongs to. No schema change is required for this concern.

**Rationale**: matches this ADR's own standing preference (§3.2, §13.4's
original intent) to reuse existing Graph read primitives rather than
invent new persisted state, while accurately reflecting which primitive
and which identifier actually apply. `review-date-sync.ts`'s
`listItemFields`/`listItemDriveItemIds` join remains exactly as useful as
before for its own purpose (§3.4's verification re-fetch, which is a
site/list-based read, unchanged) — it was never the right mechanism for
the *write's* identifier, only for the read/verify half of this feature.

**Implementation constraint**: if, during actual implementation, resolving
`driveId` via `listDrives` proves insufficient (e.g. too slow at scale
for a large bulk job, or a document's backing drive can't be
disambiguated this way in some edge case), that becomes its own,
separately-justified design decision — a new ADR or a formal amendment to
this one — not something to silently work around by adding a persisted
`driveId` field without that justification first.

### 13.5 Duplicate remediation jobs — confirmed non-goal

**Decision**: no cross-job locking, no distributed document lock, no
overlap-detection system. This is an explicit non-goal, added to §12.

**Rationale**: the write is idempotent (§9) — if two `RemediationJob`s
somehow target the same document, both writes are safe to execute in
either order or interleaved, and governance resolution (§13.2) remains
conditional on a fresh, successful verification regardless of which job
happens to run last. `RemediationItem`'s existing
`@@unique([remediationJobId, documentId])` already prevents a document
from appearing twice *within* one job; nothing further is needed
*across* jobs given idempotency.

**Implementation constraint**: the job-creation API endpoint should
prevent *accidental* duplicate submissions from a single user
interaction (e.g. a double-click) where that's straightforward — an
ordinary client-side submit-guard or a request-level check, not a new
distributed-locking mechanism. No cross-job overlap detection should be
built.

### ADR-0023 status

ADR-0023 (Microsoft Tenant Re-Consent Detection) is **fully implemented,
code-reviewed, and live-validated end to end** (2026-08-21) — see that
ADR's own §9. It is **no longer a blocker** for this ADR's implementation
(§10's bullet on this is struck through above). The interaction between
the two remains exactly as ADR-0023 itself specifies: `needsReconsent`/
`consentAssertedPermissionVersion` may inform this feature's UI (e.g.
gating the bulk-remediation entry point's visibility or messaging with a
"refresh permissions" prompt) but must never be treated as proof write
access exists, and must never influence whether an actual `PATCH` is
attempted or how its result is classified. The real, sole authority for
write-permission remains this ADR's own §8/§9 reactive `GraphPermissionError`
model, unchanged. A real 403 during a bulk write does not, and should
not, feed back into `MicrosoftTenant`'s permission-state fields —
`RemediationItem.errorType` is the correct, sufficient place for that
signal, exactly as §9 already establishes.

### Preserved decisions (explicitly reaffirmed, unchanged by this addendum)

- `Sites.ReadWrite.All` as the correct, sole additional permission (§3,
  ADR-0003's amendment) — independently reconfirmed correct during this
  investigation.
- No pre-flight write-permission probe (§8) — a real `GraphPermissionError`
  on the first write remains the authoritative signal.
- The initiating user (`RemediationJob.initiatedByUserId`) is the sole
  governance actor for any automated action this feature performs (§3.5,
  §13.2) — never a synthetic "system" actor.
- Maximum 500 selected documents per job (§7).
- Idempotent writes as the foundational safety property this whole
  architecture is built around (§9, §13.5).
- No Graph `$batch` (§12).
- No ETag/optimistic-concurrency conflict detection (§9, §12) — the
  documented, accepted stale-write risk stands unchanged.
- No second remediation action type until `SetReviewDate` is proven live
  (§12).
- No LLM/AI-based column matching (§12).
- No periodic tenant-permission health check — ADR-0023 §3.5 itself
  explicitly descoped this (no such infrastructure exists anywhere in
  this codebase today); this ADR does not reopen that question or
  introduce one of its own.

### Implementation-readiness statement

With the five decisions above resolved, **this ADR is implementation-ready.**
No further design investigation is required before Phase 3A-2 begins.

### Implementation sequence

1. `updateListItemFields` (`packages/graph-client`) — no dependency on
   anything else in this list; fully isolable and testable on its own.
2. `RemediationJob`/`RemediationItem` schema + migration (§6, as amended
   by §13.1).
3. `SetReviewDateAction` (depends on #1 and #13.4's ID-resolution
   approach).
4. `REMEDIATION_QUEUE` + worker processor, including the resume-on-retry
   and bounded-in-job-concurrency logic §3.3 already calls for (depends
   on #2 and #3).
5. Automated governance resolution (§13.2) (depends on #4 — only ever
   invoked after a real verified write).
6. API trigger + status/progress endpoints (depends on #2; independent of
   #5).
7. UI bulk-selection/remediation flow (`BulkActionToolbar`, `useApiQuery`'s
   `pollIntervalMs` — both already exist, unused; depends on #6).
8. Permission-state UX integration (§13's ADR-0023 status note above) —
   layered onto #7 last, a display-only concern with no functional
   dependency on the write path.
9. Live-tenant E2E validation (§10, §12) — non-negotiable before this is
   considered production-ready, per this ADR's own original risk
   assessment, unchanged.
