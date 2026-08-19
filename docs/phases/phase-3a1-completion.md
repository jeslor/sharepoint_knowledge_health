# Phase 3A-1 Completion Notes — Review-Date Health (Missing/Overdue/Due Soon/Healthy)

Date: 2026-08-19
Status: Complete — full monorepo verification green (16/16 turbo tasks: typecheck, lint, test, build; 1336 tests across 8 packages/apps)

## Scope delivered

Phase 3A-1 was originally committed (`69af423`) with two real defects: a
stale boolean/Date typecheck break in the demo-seed script, and a
classification (`classifyReviewDateHealth`) that was fully implemented and
tested in `@sph/scoring` but had **zero user-facing surface** — nothing in
`apps/api`'s responses or `apps/web`'s UI ever called it. This phase closes
both gaps, taking Phase 3A-1 from "scored correctly, invisible" to a
complete, demonstrable feature, per ADR-0002's amendment and ADR-0016
§17.4/§17.5.

### 1. Scoring (`packages/scoring`) — already delivered by `69af423`, unchanged here

- `ScoringInput.hasReviewDate: boolean` → `nextReviewDueAt: Date | null`.
- `scoreReviewStatus`: Missing (`null`, score 0, `RequiresReview`) / Overdue
  (past due, score 50, `NeedsAttention`) / Healthy (score 100) — Overdue is
  new; Missing and Healthy preserve prior behavior exactly.
- `classifyReviewDateHealth(nextReviewDueAt, now, dueSoonWindowDays = 30)`:
  the same three states plus a fourth, presentation-only `DueSoon` state
  (within 30 days, never scored, never a `HealthIssue`) — unchanged in this
  phase, only newly *consumed*.

### 2. Manual-write conflict guard (ADR-0016 §17.4) — already delivered by `69af423`, unchanged here

`setReviewDate` rejects (409) a manual write when the document's library
has an Active `SharePointReviewDateMapping`, identifying the mapped column
in the error message.

### 3. New in this phase — API exposure

- `packages/types`: new `ReviewDateHealthState` union
  (`'Missing' | 'Overdue' | 'DueSoon' | 'Healthy'`), redeclared rather than
  imported from `@sph/scoring` — matches this file's existing
  `IssueSeverityFilter` precedent (`packages/types` stays independent of
  `packages/scoring`). Added to both `DocumentDetailResponse`
  (`reviewDateHealth`) and `DocumentHealthResponse`
  (`nextReviewDueAt` + `reviewDateHealth`, both new — the list endpoint
  previously exposed neither field at all).
- `apps/api/src/documents/documents.service.ts`: both `getDocument` and
  `listDocumentHealth` now call `classifyReviewDateHealth` (imported
  directly from `@sph/scoring`, the same package `apps/api`'s demo-seed
  script already depends on) at request time, off the real
  `Document.nextReviewDueAt` column. `listDocumentHealth` computes one
  shared `now` for the whole page rather than re-reading the clock per
  row. **No classification logic is duplicated in the frontend** — the API
  returns the domain value directly.

### 4. New in this phase — UI exposure

- `apps/web/src/components/documents/review-date-health.ts`: label/tone
  maps (`REVIEW_DATE_HEALTH_LABEL`, `REVIEW_DATE_HEALTH_TONE`), mirroring
  `review-date-status.ts`'s existing convention for the sibling
  SharePoint-mapping status. Missing → critical (red), Overdue → warning
  (amber), Due Soon → info (blue, deliberately not a warning — nothing is
  wrong yet), Healthy → success (green).
- `apps/web/src/components/documents/review-date-health-badge.tsx`: a
  `ReviewDateHealthBadge`, mirroring `ReviewDateStatusBadge` — label and
  tone always together, never color alone.
- **Document detail page**: `DocumentReviewDate` now renders the badge next
  to the existing "Next review due …" / "No review date scheduled." text.
- **Document health table**: a new "Review date" column shows the badge
  plus the actual date (when set) — answers "which documents are missing a
  review date, overdue, or approaching their review date?" directly from
  the list view for the first time. No bulk selection, no bulk actions —
  display only, per this phase's explicit scope boundary.

### 5. New in this phase — fixes to Phase 3A-1's own loose ends

- `apps/api/src/scripts/demo-seed/seed.ts:454`: fixed the stale
  `updatedDocument!.nextReviewDueAt !== null` (boolean) call site to pass
  `updatedDocument!.nextReviewDueAt` (`Date | null`) directly, matching
  `scoreAndPersist`'s current signature. This was the one typecheck
  failure across the entire monorepo before this phase.
- `packages/database/src/repositories/tenant-isolation.spec.ts`: added
  `SharePointReviewDateMapping` to the central cross-tenant isolation
  sweep (`findByLibrary`, `findManyBySite`, `create`) — closes the gap the
  2026-08-12 review-date retrospective flagged (§4/§8 of that report):
  this repository's isolation guarantee previously lived only in its own
  dedicated spec file, not alongside every other tenant-scoped repository.

## Architecture

The classification is computed exactly once, in `apps/api`'s
`DocumentsService`, using `@sph/scoring`'s `classifyReviewDateHealth` — the
same pure function `packages/scoring`'s own test suite already covers for
all four states and the configurable window. `apps/web` never re-derives
Missing/Overdue/DueSoon/Healthy from a raw date; it only maps the
API-returned enum value to a label and a color. This keeps the domain rule
in one place (`@sph/scoring`) and the presentation concern in one place
(`review-date-health.ts`), matching this codebase's established pattern for
`review-date-status.ts` and `HealthScoreBadge`/`SeverityBadge`.

```
Document.nextReviewDueAt (Postgres)
  → DocumentsService.getDocument / listDocumentHealth (apps/api)
      classifyReviewDateHealth(nextReviewDueAt, now)   [@sph/scoring]
  → DocumentDetailResponse.reviewDateHealth / DocumentHealthResponse.reviewDateHealth  [@sph/types]
  → useDocument / (documents list hook)  [apps/web]
  → ReviewDateHealthBadge  [apps/web — label/tone lookup only, no classification logic]
```

## Validation

Full monorepo, this implementation, run via `pnpm exec turbo run typecheck
lint test build` (typecheck/lint/build via `turbo run typecheck --continue`
/ `turbo run lint --continue`, which also exercises `next build`/`nest
build`; test via `turbo run test --continue --force`):

- **Typecheck**: 8/8 packages clean (previously 7/8 — `@sph/api` failed on
  `seed.ts:454` before this phase).
- **Lint**: 8/8 packages clean.
- **Build**: `next build` (web) and `nest build` (api, worker) succeed;
  `/dashboard/documents` and `/dashboard/documents/[documentId]` both
  compile with the new column/badge.
- **Tests**: 1336 passed, 0 failed, across 158 suites —
  `@sph/config` 9, `@sph/scoring` 46, `@sph/graph-client` 53,
  `@sph/review-date-discovery` 39, `@sph/database` 80 (76 prior + 4 new
  isolation tests), `@sph/worker` 124, `@sph/api` 483 (478 prior + 5 new:
  4 `reviewDateHealth` classification cases in `getDocument`, 1 per-row
  case in `listDocumentHealth`), `@sph/web` 502 (490 prior + 12 new: 4
  `document-health-table` column cases, 4 `document-review-date` badge
  cases via `it.each`, 4 dedicated `ReviewDateHealthBadge` label cases).
- Two transient failures were observed on one `--force` run under full
  8-package concurrent load against Postgres (`@sph/database`'s
  `onboarding.spec.ts`, an unrelated pre-existing test; `@sph/web`'s
  `use-review-date-libraries.test.ts`, a file untouched by this phase) —
  both passed cleanly in isolated re-runs and on a subsequent full run,
  confirming resource contention under forced concurrent execution, not a
  regression introduced by this work.
- `prisma migrate status`: unchanged — this phase introduced no schema
  change (`SharePointReviewDateMapping`'s isolation test uses the existing
  model; `reviewDateHealth` is computed, never persisted).

## Deferred work — explicitly out of scope for this phase

The following remain entirely unimplemented, matching ADR-0022's own
"Accepted (planning) — Phase 3A-0" status and ADR-0003/ADR-0013's
"documented only, not implemented before Phase 3A-2" amendments:

- `Sites.ReadWrite.All` Graph permission scope — not requested, no consent
  flow or re-consent UI exists.
- `updateListItemFields` — no Graph write function exists anywhere in
  `@sph/graph-client`; it remains a read-only package.
- Any SharePoint write execution of any kind.
- `RemediationJob`, `RemediationItem`, `REMEDIATION_QUEUE` — no schema, no
  queue, no processor.
- `SetReviewDateAction` or any other remediation action implementation.
- Bulk document selection or bulk remediation execution in the UI —
  `BulkActionToolbar` still has zero real consumers; this phase's table
  change is read-only status display, not a selection affordance.
- Automatic `GovernanceIssue` resolution from a worker/remediation process
  — `GovernanceIssue` remains 100% human-driven, unchanged.

## Follow-up (not started, not implied complete by this phase)

- **`Sites.ReadWrite.All` re-consent investigation** (ADR-0003 amendment,
  ADR-0022 §10/§12's explicit Phase 3A-2 prerequisite): confirming, against
  a real tenant, that re-running Microsoft's `/adminconsent` endpoint after
  the Azure app registration's manifest gains a new permission correctly
  updates an already-connected tenant's grant, plus designing a Settings
  entry point for an existing Admin to trigger it. Not started by this
  phase; the existing `ConsentCallbackController`/`resolveOrProvisionFromConsent`
  path already tolerates a repeat callback against an already-connected
  tenant safely (resolves to `kind: 'existing'`), which narrows — but does
  not eliminate — the remaining investigation to the manifest change and
  the missing UI entry point.
- **ADR-0022 (Bulk Remediation Job Architecture)**: remains planning-only.
  This phase makes Missing/Overdue/Due Soon a real, visible, per-document
  and per-list-row fact for the first time — the prerequisite ADR-0022's
  own UX proposal (§7: select documents that need fixing) assumed but that
  didn't previously exist anywhere in the product. Whether to build
  `RemediationJob`/`RemediationItem`/`REMEDIATION_QUEUE` next is a separate
  decision, not made by this phase.
- **Live-tenant click-through** of the review-date UI (recommended by the
  2026-08-12 retrospective, still outstanding) — the new badge/column are
  covered by unit/integration tests only, consistent with this sandboxed
  environment having no real Entra app registration or SharePoint tenant
  available.
