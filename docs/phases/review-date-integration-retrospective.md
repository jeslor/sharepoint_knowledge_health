# SharePoint Review-Date Integration — Retrospective & Transition Report

Date: 2026-08-12
Status: Complete — Phases 1, 1.1, 1.2, and 2 all implemented, verified, and accepted.
Covers: `ADR-0016 §17` (§17.1–§17.3), `@sph/review-date-discovery`,
`apps/api/src/sharepoint-metadata/`, `apps/worker/src/sharepoint-metadata/`,
`apps/web/src/components/sharepoint/review-date-*`,
`apps/web/src/app/dashboard/sharepoint/[siteId]/review-dates/`.

This report supersedes the original "Phase 1 Retrospective" scope: it
covers the full delivered lifecycle, not just Phase 1, and Phase 2 is
described as delivered, not as a future candidate.

## 1. Delivered capabilities

- **Automatic review-date sync from a SharePoint column.** Once an admin
  explicitly confirms a mapping for a document library, the worker's scan
  pipeline reads that column's value on every scan and keeps
  `Document.nextReviewDueAt` in sync, with `reviewDateSource` correctly
  set to `GraphMetadata`.
- **Explicit, per-library opt-in with no silent activation.** Nothing about
  a library's review-date behavior changes until an admin takes an
  explicit confirm action. Libraries with zero or multiple eligible
  columns can never auto-activate — they require an explicit choice or
  stay Manual indefinitely.
- **A read-only eligibility/discovery endpoint** (`GET
  .../review-date-mapping/eligibility`) and a **library-listing endpoint**
  (`GET .../review-date-libraries`) that let both API consumers and the
  UI inspect state without side effects.
- **Explicit multi-candidate selection**, always re-validated against the
  live candidate set at confirm time — a client can never rely on a
  stale, previously-fetched candidate list to activate a mapping.
- **Stale-mapping detection and safe remediation.** If a confirmed
  column stops resolving in Graph, the mapping flips to `Stale`, the
  worker stops applying values from it, and the last known
  `nextReviewDueAt` is preserved unchanged — never silently cleared. An
  admin can choose a replacement column only via a fresh eligibility
  check; the UI never auto-rebinds to a column that happens to share the
  old display name.
- **Full admin UI** (`/dashboard/sharepoint/[siteId]/review-dates`,
  linked from the Sites list for `Approved` sites): per-library status
  (not checked / no eligible column / needs selection / active / stale),
  a visible-before-confirmation overwrite warning, and plain-English
  copy with no raw Graph terminology (`graphListId`,
  `columnDefinition.id`, "dateTime facet" never surface in the UI).
- **Document-level source indicator.** The existing per-document
  "Scheduled review date" control now shows *"Source: SharePoint · Review
  Date"* or *"Source: Manually managed"* beneath the date itself, without
  any change to the existing save/clear controls.
- **Structured, greppable observability** for every sync and confirm
  attempt, correlated end-to-end via a per-attempt `correlationId`.

## 2. Final architecture and data flow

```
apps/worker/src/queue/document-collector.processor.ts (per-drive loop)
  │  drive.list?.id resolved via listDrives' $expand=list($select=id)
  ▼
apps/worker/src/sharepoint-metadata/review-date-sync.ts
  │  syncConfirmedReviewDateMapping(context, tenantId, site, graphListId, logger)
  │  no-op if no confirmed mapping exists for this library (the common case)
  ▼
@sph/review-date-discovery (resolveReviewDateCandidates)
  │  Layer 1: column carries the dateTime facet
  │  Layer 2: excludes isDeletable === false, or name ∈ {Created, Modified}
  ▼
@sph/graph-client (listColumns, listContentTypes, listItemFields,
                    listItemDriveItemIds) — read-only Graph calls only
  ▼
packages/database SharePointReviewDateMappingRepository
  │  upsertActive (race-hardened on the (siteId, graphListId) unique index)
  │  status: Active | Stale
  ▼
Document.nextReviewDueAt / reviewDateSource updated per §17.1's precedence rule
```

The admin-facing read path is a parallel, independent branch that never
mutates anything except through one explicit action:

```
apps/api/src/sharepoint-metadata/sharepoint-metadata.controller.ts
  GET  .../review-date-libraries        → listReviewDateLibraries (no role restriction)
  GET  .../review-date-mapping/eligibility → checkReviewDateEligibility (no role restriction)
  POST .../review-date-mapping/confirm  → confirmReviewDateMapping (Admin/GovernanceManager only)
       │  selectConfirmCandidate() re-validates the selection against a
       │  freshly-resolved candidate set — never trusts a client-held id
       ▼
       SharePointReviewDateMappingRepository.upsertActive
```

`SharePointReviewDateMapping` (Prisma model, migration
`20260810112144_add_sharepoint_review_date_mapping`): `id`,
`organizationId`, `siteId`, `graphListId`, `columnDefinitionId`,
`columnDisplayNameAtConfirmation`, `status (Active|Stale)`,
`staleDetectedAt`, `confirmedByUserId`, `confirmedAt`, `createdAt`,
`updatedAt`, unique on `(siteId, graphListId)`.

Frontend: `apps/web/src/components/sharepoint/review-date-status.ts` is
the single module encoding the entire state-derivation mental model
(`NotChecked | NoEligibleColumn | SingleEligibleColumn |
MultipleEligibleColumns | Active | Stale`) — every component (badge,
candidate selector, confirm dialog, library list) reads from this one
derivation rather than re-deriving status locally.

## 3. Relevant ADR changes

All recorded in `docs/decisions/0016-document-governance-actions-and-issue-management.md`
§17 (no other ADR was amended):

- **§17.1** resolves §4.3's previously-open question: a confirmed mapping
  makes SharePoint authoritative and may supersede a Manual value; absent
  a confirmed mapping, Graph metadata has no path to alter a Manual value
  under any circumstance.
- **§17.2** records the live-validation-driven system-column exclusion
  fix, the extraction to `@sph/review-date-discovery` (and the
  accompanying clarification that ADR-0009 blocks direct `apps/worker` ↔
  `apps/api` imports, not a third shared package both already depend on),
  and the display-only, non-persisted confidence signal.
- **§17.3** records the Phase 1.2 observability pass as an operational
  hardening note, not a new architectural decision, and points to
  `docs/features/review-date-sync-operations.md` for the full detail
  rather than duplicating it.

Phase 2 (the admin UI) introduced no further ADR changes — it consumes
the already-decided precedence, discovery, and confidence rules
unmodified; nothing about backend sync/precedence/recovery behavior was
altered to build it.

## 4. Security / tenant-isolation decisions

- Every backend entry point resolves through `createTenantContext(organizationId)`,
  the same mechanism every other repository/service in this codebase
  uses — no bespoke isolation logic was introduced for this feature.
- `SharePointReviewDateMappingRepository`'s own spec
  (`sharepoint-review-date-mapping-repository.spec.ts`) directly verifies
  org-scoping: `upsertActive` writes rows scoped to the confirming
  organization ("scopes the created row to this organization, matching
  every other repository method"), and `findManyBySite` is verified
  against a second, independently-created organization to confirm it
  never returns another org's mapping.
- **Gap worth flagging honestly**: this org-isolation coverage lives in
  the repository's own spec file, not in the codebase's central
  cross-cutting sweep (`packages/database/src/repositories/tenant-isolation.spec.ts`),
  which does not yet include `SharePointReviewDateMapping`. The guarantee
  is real and tested, just not consolidated with the other repositories'
  isolation checks — a low-risk documentation/consistency gap, not an
  unverified isolation boundary.
- Confirming a mapping is restricted to `Admin`/`GovernanceManager` via
  the same `RolesGuard`/`@Roles()` pattern used elsewhere; the two
  read-only endpoints (`eligibility`, `review-date-libraries`) carry no
  role restriction, matching the documented rationale that nothing is
  mutated by either.

## 5. Graph permissions and SharePoint write boundaries

- No new Graph permission scopes were requested. Every Graph call this
  feature makes (`listColumns`, `listContentTypes`, `listItemFields`,
  `listItemDriveItemIds`, and the `list($select=id)` expand on
  `listDrives`) is a read under the existing `Files.Read.All`/
  `Sites.Read.All` application permissions fixed by ADR-0003 — confirmed
  directly by grepping `packages/graph-client/src/{columns,list-items,drives}.ts`
  for write HTTP verbs (`POST`/`PATCH`/`PUT`/`DELETE`); none exist.
- This integration **never writes to SharePoint**. "Confirming a mapping"
  only writes a row to this product's own `SharePointReviewDateMapping`
  table — it never creates, renames, or modifies a column in the
  customer's SharePoint site. The Phase 2 "no eligible column" UI state
  explicitly tells the admin to create a column themselves in SharePoint
  and return; the product does not and cannot do this on their behalf
  under the current permission grant.

## 6. Observability improvements (Phase 1.2)

Full detail lives in `docs/features/review-date-sync-operations.md`;
summarized here for completeness:

- Sync and confirm each log exactly once per attempt — a structured
  `key=value` success or failure line (never JSON), matching
  `apps/api/src/common/request-logger.middleware.ts`'s existing
  convention. Never logs document names, paths, or the review date value
  itself — only ids, counts, and status.
- A single `correlationId` (`crypto.randomUUID()`) is generated per sync
  attempt and per confirm attempt, threaded through every Graph call
  made within that attempt via the existing `ListOptions` parameter, and
  included in the resulting log line — one id to grep for the full story
  of one attempt.
- Eligibility checks generate and pass a correlation ID to their Graph
  calls too (so a Graph-side failure still carries one), but the
  eligibility action itself is deliberately not logged — a read-only
  inspection, not a lifecycle event.
- No server-side throttling was added to the eligibility endpoint — this
  codebase has no existing rate-limiting pattern to reuse, and the
  documented expected usage (on-demand per library, confirmed by Phase
  2's actual implementation: `useReviewDateEligibility` only fires on an
  explicit "Check for a review-date column" click, never polled or
  auto-run) doesn't currently justify introducing one speculatively.

## 7. Testing and verification results

**Dedicated review-date test files** (all currently passing):

| Layer | File(s) | Tests |
|---|---|---|
| `@sph/review-date-discovery` | `review-date-candidates.spec.ts`, `review-date-confidence.spec.ts` | 22 |
| `@sph/graph-client` | `columns.spec.ts`, `drives.spec.ts`, `list-items.spec.ts` | 24 |
| `@sph/database` | `sharepoint-review-date-mapping-repository.spec.ts` | 8 |
| `apps/worker` | `review-date-sync.spec.ts` | 28 |
| `apps/worker` | `document-collector.processor.spec.ts` (review-date wiring subset) | part of 50 |
| `apps/api` | `sharepoint-metadata.service.spec.ts` + `.controller.spec.ts` | 47 |
| `apps/api` | `documents.service.spec.ts` (`reviewDateColumnDisplayName` subset) | 4 of 33 |
| `apps/web` | `review-date-status.test.ts`, `-status-badge`, `-candidate-selector`, `-confirm-dialog`, `-library-list` | 44 |
| `apps/web` | hooks: `use-review-date-libraries`, `use-review-date-eligibility`, `use-confirm-review-date-mapping` | 16 |
| `apps/web` | `sharepoint-site-list.test.tsx` (review-date link subset), `document-review-date.test.tsx` | 27 |

**Full-suite regression results** (proves no unrelated breakage), last run
against current `HEAD` (`ce6ea14`):

- `@sph/graph-client`: 53/53 (8 suites)
- `@sph/database`: 76/76 (11 suites)
- `@sph/review-date-discovery`: 22/22 (2 suites)
- `apps/api`: 468/468 (38 suites)
- `apps/worker`: 123/123 (10 suites)
- `apps/web`: 478/478 (80 suites)

**Static/build verification**: typecheck and lint clean across all six
packages/apps; `nest build` (api, worker) and `next build` (web) all
succeed; the new `/dashboard/sharepoint/[siteId]/review-dates` route
registers correctly as a dynamic route in the production build.

`prisma migrate status`: 15 migrations found, database schema up to
date — no drift.

**Not verified**: no live/manual click-through against a real Microsoft
365 tenant was performed for Phase 2's UI (Phase 1's initial design was
corrected once by exactly this kind of live validation — see §17.2 — so
this remains a real, not hypothetical, residual risk). All verification
for Phase 2 is automated (unit/integration tests, typecheck, build) —
consistent with this sandboxed environment having no real Entra app
registration or SharePoint tenant available, the same constraint
recorded for MSAL login in `docs/phases/phase-6-completion.md`.

## 8. Known limitations and deferred work

Carried forward from `docs/features/review-date-sync-operations.md`
(each requires its own separate design pass — not attempted in any phase
of this feature):

- **Delta queries** — every scan does a full column/value sweep for each
  confirmed library, even when nothing changed. Graph delta/change-tracking
  support could reduce steady-state load but was not implemented.
- **Sync-state persistence** — no "last synced at" / "last known state
  hash" is persisted per mapping; every scan re-evaluates from scratch.
  Deliberately no schema change for this in any phase so far.
- **Parallel drive processing** — confirmed-library syncs within one scan
  run strictly sequentially in the worker's per-drive loop.
- **Caching for the eligibility endpoint** — every call is a live,
  uncached Graph round-trip. No caching layer was introduced; Phase 2's
  actual usage pattern (on-demand, one check per row, never polled)
  hasn't produced a demonstrated need for one.
- **No persisted audit trail for confirm actions** — beyond the
  structured log line, there is still no `AuditLog`/`GovernanceActivity`
  entry recorded when an admin confirms or changes a mapping.
- **`SharePointReviewDateMapping` is absent from the central
  `tenant-isolation.spec.ts` sweep** (§4 above) — real, tested isolation,
  just not consolidated with the rest.
- **No automatic SharePoint column creation** — by design, not a gap:
  ADR-0003's read-only permission grant makes this structurally
  impossible without a separate, explicit future decision to request
  write scopes.
- **No live tenant validation for the Phase 2 UI** (§7 above).

## 9. Production-readiness assessment

The backend sync/precedence/recovery path (Phases 1 and 1.1) has already
been through one real live-validation cycle that found and fixed a
genuine production-blocking defect (§17.2), giving reasonable confidence
in its correctness beyond what unit tests alone would show. The
observability pass (Phase 1.2) gives operators a real, greppable
diagnostic path for both success and failure without new infrastructure.
The admin UI (Phase 2) is fully unit/integration-tested and enforces
every safety guarantee from the approved plan (no auto-activation, no
silent stale-rebind, overwrite warning always visible before
confirmation, explicit multi-candidate selection) at the code level, but
has not yet had the same live-tenant validation pass that caught the
Phase 1 defect.

**Assessment: ready for production use of the sync/confirm backend;
recommend one live-tenant click-through of the Phase 2 UI before
considering it fully validated**, given the Phase 1 precedent that
sandbox validation alone missed a real defect.

## 10. Recommended next steps

1. Perform one live-tenant click-through of the Phase 2 UI (all six
   states: not checked, no eligible column, single/multiple candidates,
   active, stale-remediation) against a real Microsoft 365 tenant, the
   same validation step that caught §17.2's defect for the backend.
2. Add `SharePointReviewDateMapping` to `tenant-isolation.spec.ts`'s
   central sweep for consistency with every other repository (low
   effort, closes the gap noted in §4/§8).
3. Treat delta queries, sync-state persistence, parallel drive
   processing, and eligibility caching as candidate work only if a real
   performance or cost signal justifies them — none are currently
   blocking.
4. No further action needed on ADR-0016 §17 — it is complete and
   consistent with the shipped implementation.
