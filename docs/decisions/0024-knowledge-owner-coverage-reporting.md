# ADR-0024: Knowledge Owner Coverage Reporting

Date: 2026-08-28
Status: Proposed — awaiting approval before implementation. Scoped to Phase A (read-only reporting) only; Phase B (bulk owner assignment, §10) is documented for context and is explicitly not implementation scope.

---

## 1. Problem Statement

`docs/product/roadmap.md`'s Version 2 ordering names "Knowledge Owners" as the next priority after the governance remediation loop (ADR-0021/ADR-0022), described as *"a natural, low-cost follow-on... ownership assignment already exists; this adds coverage/accountability reporting on top of it."* Per-document ownership assignment has existed since Phase 8B (ADR-0016 §4.2) and the `Ownership` scoring criterion has existed since Phase 5 (ADR-0002) — but there is no organization-wide view of ownership health today. An Admin/GovernanceManager can only learn a document lacks an owner (or has only deactivated owners) by opening that one document's detail page. There is no way to answer "how much of our content is actually accountable to someone," "which sites are worst," or "how many owners come from SharePoint metadata versus manual assignment" without inspecting documents one at a time.

This ADR is the design decision for closing that gap with a read-only reporting feature, structurally modeled on `GovernanceAnalyticsService` (ADR-0016 §14, Phase 8D), which solved the same class of problem for governance issues.

## 2. Current Limitation

Confirmed via direct inspection of the actual implementation, not assumed:

1. **No aggregate ownership view exists anywhere** — `GovernanceAnalyticsService` aggregates `GovernanceIssue`/`GovernanceActivity`; nothing aggregates `DocumentOwner` or the `Ownership` `HealthIssue` criterion specifically, org-wide or per-site.
2. **`DocumentOwner` is a child entity, not a single field** (`prisma/schema.prisma:461-481`) — a `Document` can have zero, one, or multiple `DocumentOwner` rows simultaneously, partitioned by `source: GraphMetadata | ManualAssignment`. `GraphMetadata` rows are wholly replaced on every scan (`document-collector.processor.ts::syncOwner`); `ManualAssignment` rows are only ever created/deleted via `documents.controller.ts`'s owner endpoints and survive every rescan untouched (ADR-0016 §4.2).
3. **An owner has no required identity** — `DocumentOwner`/`AssignDocumentOwnerRequest` carry only `displayName`/`email` as free text, never a `userId`. `resolveOwnerUserId` (`apps/api/src/common/resolve-owner-user.ts`) is a best-effort match against a registered, `Active` Knowledge Health `User` by email, used only for notification-targeting and governance-assignee-defaulting — never as a validity requirement for "is this a real owner."
4. **The `Ownership` `HealthIssue` already encodes exactly the two failure states this report needs** (`packages/scoring/src/rules/ownership.ts`): score 0 / severity `RequiresReview` / *"Document has no identifiable owner"* when zero `DocumentOwner` rows have a non-null email; score 40 / severity `NeedsAttention` / *"Document owner is no longer an active user"* when every owner that resolves to a registered `User` is `Deactivated`. **An owner whose email matches no registered `User` at all is not a failure state** — it is excluded from the "all inactive" check entirely (`resolvedOwners.filter(owner => owner.isActiveUser !== null)`), so an external/unregistered owner counts as acceptable ownership *on its own*. This report must reuse this exact, already-computed conclusion rather than re-deriving ownership health from raw `DocumentOwner` rows with a second, parallel definition.
5. **An external/unregistered owner never offsets an inactive recognized owner** — confirmed by tracing `scoreOwnership` directly: `resolvedOwners` (the subset checked for "all inactive") only ever contains owners whose email *does* resolve to a registered `User`; a non-resolving external owner is simply invisible to that check, not a mitigating factor. Concretely: `{external owner} + {one inactive, resolved owner}` still produces the `allOwnersInactive` issue (`NeedsAttention`) — the check is "is there at least one resolved owner, and are all *resolved* owners inactive," not "is there at least one acceptable owner of any kind." This is easy to misread as "any owner present protects the document" — it does not.

## 3. Decision

### 3.1 Source of truth: the current `HealthScore`'s `Ownership` `HealthIssue`, not a re-derivation from `DocumentOwner`

Coverage state per document is read directly off whether the document's **current** `HealthScore` (`Document.currentHealthScoreId`) has an `HealthIssue` row with `criterion: 'Ownership'`, and that issue's `severity`:

| Document state | Condition | Bucket |
|---|---|---|
| Not yet scored | `Document.currentHealthScoreId` is `null` | `notYetScored` |
| No identifiable owner | current score has an `Ownership` issue, `severity: RequiresReview` | `noIdentifiableOwner` |
| All recognized owners deactivated | current score has an `Ownership` issue, `severity: NeedsAttention` | `allOwnersInactive` |
| Covered | current score has **no** `Ownership` issue | `covered` |

These four buckets partition every `Active` document exactly once. This is deliberately coupled to `scoreOwnership`'s current threshold choice (0 → `RequiresReview`, 40 → `NeedsAttention`, both distinct from the 100/no-issue case) — if those thresholds ever change, this report's bucket mapping must be re-verified against the rule, the same dependency any other severity-reading consumer already has. See §2.5 for the one non-obvious multi-owner interaction (an external owner does not offset an inactive resolved owner).

**Invariant 1 (exhaustiveness, holds by construction, must be asserted in tests — §7)**:
```
covered + noIdentifiableOwner + allOwnersInactive + notYetScored = totalDocuments
```

**Why not re-derive from `DocumentOwner` directly**: doing so would create a second, parallel definition of "acceptable ownership" that could silently drift from the scoring engine's actual behavior (e.g., forgetting the external-owner-is-acceptable rule, or the exactly-two-Ownership-branches assumption). Reading the already-computed `HealthIssue` is the single-source-of-truth choice, matching how `resolveEligibility` (`apps/api/src/remediation/remediation.service.ts`) already reads `HealthIssue` rather than re-scoring, for the same reason.

### 3.2 Exact metric definitions

- **Total active documents**: `count(Document where status = 'Active')`, scoped to the organization.
- **Covered**: documents in the `covered` bucket (§3.1).
- **No identifiable owner**: documents in the `noIdentifiableOwner` bucket.
- **All owners deactivated**: documents in the `allOwnersInactive` bucket.
- **Not yet scored**: documents in the `notYetScored` bucket — reported separately, never folded into either "covered" or "not covered," so the reader can distinguish "genuinely a problem" from "scoring hasn't run yet."
- **Scored documents** (derived, not independently stored): `scoredDocuments = totalDocuments - notYetScored`, equivalently `covered + noIdentifiableOwner + allOwnersInactive`.

  **Invariant 2**:
  ```
  scoredDocuments = covered + noIdentifiableOwner + allOwnersInactive
  ```
- **Ownership coverage percentage**: **the denominator is `scoredDocuments`, never `totalDocuments`** — a `notYetScored` document must never silently lower this percentage the way a genuinely uncovered document would. Rounded to the nearest whole percent, matching `compositeScore`'s existing rounding convention (`calculate-score.ts`).

  **Invariant 3**:
  ```
  coveragePercentage = scoredDocuments > 0
    ? round(covered / scoredDocuments * 100)
    : null
  ```
  `null` (never `0`) when nothing has been scored yet — a `0%` reading must only ever mean "we checked, and nothing is covered," never "we haven't checked." The UI (§4/§5) must render a distinct "not yet scored" state whenever `coveragePercentage` is `null`, not a misleading `0%`.
- **Breakdown by SharePoint site**: the same four buckets and the same percentage formula (Invariants 1-3, applied per site, via one shared computation function — never a second, independently-written implementation), grouped by `Document.siteId` / `SharePointSite.displayName`. **Every site with at least one `Active` document is included, regardless of that site's current `SharePointSiteStatus`** — confirmed directly against `document-collector.processor.ts::scoreTenantDocuments`'s actual query (`where: { status: 'Active', site: { microsoftTenantId } }`, no site-status filter at all) and the documented, existing behavior that revoking a site (`LAT §5.5.2`) does not delete or reclassify its already-collected `Document` rows. Filtering `bySite` to `Approved` sites only would silently drop documents the org-wide total still counts.

  **Invariant 4**:
  ```
  sum(bySite[].totalDocuments) = organizationWide.totalDocuments
  ```
- **Owner source breakdown**: `count(DocumentOwner where source = 'GraphMetadata')` vs. `count(DocumentOwner where source = 'ManualAssignment')`, scoped to owners of `Active` documents — a row-level count (a document with owners from both sources contributes to both), computed via an entirely separate query against `DocumentOwner`, never combined with, divided by, or compared against the document-level coverage buckets above as if they shared a denominator.
- **Registered/active vs. external/unregistered owners** (secondary, descriptive only — explicitly not part of the coverage percentage): among all `DocumentOwner` rows with a non-null email on `Active` documents, three counts — resolves to an `Active` `User`; resolves to a `Deactivated` `User`; matches no registered `User` at all (external/unregistered). **This breakdown must never be presented as "external = invalid"** — per §2.4, an external owner is already acceptable ownership on its own (though see §2.5's qualification); this metric exists purely to answer "how much of our recognized ownership is actually inside the platform versus outside it," not to flag external owners as a problem.

  **Invariant 5**:
  ```
  Owner-source counts (GraphMetadata / ManualAssignment) and the
  identity breakdown (active-registered / deactivated-registered /
  external-or-unregistered) are independent row-level metrics.
  Neither may be used as, or compared against, the coverage
  percentage's denominator (scoredDocuments).
  ```

### 3.3 Aggregation strategy — reuses `GovernanceAnalyticsService`'s exact precedent

- **Document-level coverage buckets (§3.1, org-wide and per-site)**: requires grouping by a *derived* condition (does the current score have an `Ownership` issue, and which severity) — not a plain column `groupBy`, the same shape `GovernanceAnalyticsService.resolutionTimeDistribution`/`issueAging` already hit and deliberately kept in-memory rather than introducing `$queryRaw` for (*"this codebase uses `$queryRaw` in exactly one place today, a liveness probe; a duration-histogram aggregate is a materially different, riskier use of raw SQL than this conservative pass is scoped for"*). This ADR follows the identical discipline: one narrow, indexed fetch — `Document` rows scoped to `status: 'Active'` with `id, siteId, currentHealthScoreId` only — plus one batched `HealthIssue.findMany({ where: { healthScoreId: { in: [...] }, criterion: 'Ownership' } })` keyed by `healthScoreId` (mirroring `RemediationItemRepository.groupByStatusForJobs`'s existing batched-lookup shape), bucketed in Node. Not a full-table, unbounded fetch — narrowly scoped to exactly the columns and the one criterion needed.
- **Owner source breakdown (§3.2)**: this *is* expressible as a real, typed Prisma `groupBy` on a single column (`source`) — a new `DocumentOwnerRepository.groupBySource()` method, following `GovernanceIssueRepository.groupByIssueType`/`groupByStatus`'s exact existing shape (`prisma.documentOwner.groupBy({ by: ['source'], where: {...}, _count: { _all: true } })`), scoped to organization + owners of `Active` documents.
- **Registered/active vs. external breakdown**: one batched `User.findMany({ where: { email: { in: [...distinct owner emails...] } } })` plus in-memory classification — the same `activeByEmail` pattern `document-collector.processor.ts::scoreTenantDocuments` already uses to build the scoring input, reused for its exact purpose (never re-implemented differently).

No `$queryRaw` is introduced. No new Prisma schema field or migration is needed — every value this report needs (`Document.status/siteId/currentHealthScoreId`, `HealthIssue.criterion/severity`, `DocumentOwner.source/email`, `User.status/email`) already exists.

### 3.4 API contract

One new endpoint, mirroring `GET /organizations/:id/governance/analytics`'s shape exactly:

```
GET /organizations/:id/ownership-coverage
```

Response (new types in `packages/types/src/api/ownership.ts`, following `AnalyticsBucket`'s existing precedent):

```ts
export interface OwnershipCoverageBucket {
  covered: number;
  noIdentifiableOwner: number;
  allOwnersInactive: number;
  notYetScored: number;
  // Invariant 1: covered + noIdentifiableOwner + allOwnersInactive + notYetScored === totalDocuments
  totalDocuments: number;
  // Invariant 2: scoredDocuments === covered + noIdentifiableOwner + allOwnersInactive
  // (=== totalDocuments - notYetScored). Included explicitly so a consumer never
  // has to re-derive it, and never mistakenly uses totalDocuments as the
  // coverage-percentage denominator instead.
  scoredDocuments: number;
  // Invariant 3: round(covered / scoredDocuments * 100) when scoredDocuments > 0,
  // otherwise null. NEVER 0 when scoredDocuments is 0 — null unambiguously means
  // "nothing scored yet," 0 unambiguously means "scored, and none of it covered."
  coveragePercentage: number | null;
}

export interface OwnershipCoverageBySite extends OwnershipCoverageBucket {
  siteId: string;
  siteName: string;
}

export interface OwnershipSourceBreakdown {
  graphMetadataCount: number;
  manualAssignmentCount: number;
}

export interface OwnershipIdentityBreakdown {
  activeRegisteredCount: number;
  deactivatedRegisteredCount: number;
  externalOrUnregisteredCount: number;
}

export interface OwnershipCoverageResponse {
  organizationWide: OwnershipCoverageBucket;
  bySite: OwnershipCoverageBySite[];
  ownerSourceBreakdown: OwnershipSourceBreakdown;
  identityBreakdown: OwnershipIdentityBreakdown;
  calculatedAt: string;
}
```

No query parameters in Phase A (no filtering/pagination — see §7 on why). `OwnershipCoverageService.getCoverage(organizationId)` (new, `apps/api/src/ownership/`) computes this on every request — read-only, no caching, matching `GovernanceAnalyticsService`'s own uncached-per-request precedent.

### 3.5 Tenant isolation & authorization

Identical to every existing read endpoint in this API — no new pattern:
- `@Controller('organizations/:id')`, `@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)`.
- **No `RolesGuard`/`@Roles`** — read-tier, same convention as `GovernanceAnalyticsController`/`AuditLogController`/the P0-3 remediation GET routes (*"any authenticated org member may read this... only mutations carry a Roles guard anywhere in this API"*).
- All queries go through `createTenantContext(organizationId)` — no direct, unscoped Prisma access anywhere in this feature.

## 4. UI/dashboard scope

**A small page, not a new subsystem** — one new route, `/dashboard/governance/owners`, mirroring `/dashboard/governance/analytics`'s existing precedent exactly (a sibling analytics-style sub-route reached via a link from the Governance page's `PageHeader` action slot, not a new top-level nav-sidebar entry — `dashboard-nav.tsx`'s `GROUPS` array is unchanged). This location fits better than a Documents sub-route because ownership coverage is a governance-health question (same family as issue analytics), not a document-detail concern.

Contents: the four coverage numbers + percentage as summary cards (reusing `GovernanceSummaryCards`'s existing card shape/component if directly applicable, or the same visual pattern), a per-site table (reusing the existing table styling from `RemediationJobList`/`ScanList`, not a new table component), and two small bar-chart-style breakdowns (owner source, identity) reusing `IssuesByType`'s existing bar-chart component (`apps/web/src/components/governance/issues-by-type.tsx`) if its shape generalizes to a plain label/count list — it already renders exactly `AnalyticsBucket[]`-shaped data.

## 5. Loading/empty/error states

Standard, existing pattern — `LoadingState`/`ErrorState`/`EmptyState` (`@/components/ui/query-state`), `useApiQuery`-backed hook (`useOwnershipCoverage`), no polling (this is a point-in-time report, not a running job — no analog to ADR-0022's "still in flight" state exists here).

Two distinct empty states, both governed by Invariant 3 (§3.2), never a `NaN`:
- **Zero active documents** (`totalDocuments === 0`): `scoredDocuments` is also `0`, so `coveragePercentage` is `null` — the UI shows a "no documents yet" message, not a coverage percentage of any kind.
- **Active documents exist, but none are scored yet** (`totalDocuments > 0`, `scoredDocuments === 0`, e.g. immediately after onboarding, before the first scan completes): `coveragePercentage` is still `null` under Invariant 3 — the UI must show a distinct "not yet scored" message (using the `notYetScored` count, which equals `totalDocuments` here), never a misleading `0%` that would read as "checked, and none of it is covered." This applies identically at the per-site level (a site whose documents haven't been scored shows the same "not yet scored" state, not `0%`).

## 6. Pagination or limits

**None needed.** `bySite` is bounded by the organization's actual site count (already small — no organization in this product has hundreds of `SharePointSite` rows; unlike `RemediationJob`/`GovernanceIssue`, sites are not something that accumulates unboundedly over time). If a future organization's site count grows large enough to matter, that's the same, already-accepted scale risk `docs/architecture/operations.md` already flags for `GovernanceAnalyticsService`'s in-memory aggregation generally — not a new risk this ADR introduces.

## 7. Testing strategy

Mirrors `GovernanceAnalyticsService.spec.ts`'s existing shape. At minimum, every invariant from §3.1/§3.2 must have a dedicated, explicit assertion — not just be true incidentally of whatever fixtures a test happens to use:

- **`OwnershipCoverageService`**:
  - Each of the four buckets computed correctly from a controlled set of `HealthIssue`/`Document` fixtures, covering every scenario in §2.5's multi-owner analysis — including the explicit case proving `{external owner} + {one inactive resolved owner}` produces `allOwnersInactive`, **not** `covered` (the one non-obvious interaction this ADR's review corrected).
  - **Invariant 1** asserted directly: the four buckets sum to `totalDocuments` for a fixture set spanning all four states.
  - **Invariant 2** asserted directly: `scoredDocuments === covered + noIdentifiableOwner + allOwnersInactive`.
  - **Invariant 3** asserted directly, both branches: `coveragePercentage` rounds correctly when `scoredDocuments > 0`; is `null` (never `0`, never `NaN`) both when `totalDocuments === 0` and when `totalDocuments > 0` but `scoredDocuments === 0`.
  - **Invariant 4** asserted directly: a fixture with a document under a non-`Approved` (e.g. `Removed`) site still appears in `bySite`, and `sum(bySite[].totalDocuments) === organizationWide.totalDocuments`.
  - **Invariant 5** asserted directly: owner-source and identity breakdown counts are computed from a query independent of the coverage buckets, and a test proves an external/unregistered owner is never counted as a coverage failure on its own (per §2.4).
- **`DocumentOwnerRepository.groupBySource`**: new repository method, tested the same way `tenant-isolation.spec.ts` already sweeps every repository (cross-organization isolation) plus a dedicated correctness test, following `RemediationItemRepository.groupByStatusForJobs`'s exact precedent.
- **`OwnershipCoverageController`**: guard wiring (no `RolesGuard`, tenant/org-access guards present), delegates to the service correctly.
- **Web**: hook test (`use-ownership-coverage.test.ts`, mirrors `use-governance-issue-type-counts.ts`-style hooks), page test (loading/error/empty/populated, including the distinct "not yet scored" vs. `0%` states from §5), and a component test for whatever new presentational pieces don't already have coverage (site table, breakdown charts) — reusing existing tested components (`IssuesByType`, `GovernanceSummaryCards`, `ScanList`-style tables) wherever their existing tests already cover the rendering shape.

## 8. Non-Goals (Phase A)

- No bulk owner assignment (§10, deferred to Phase B).
- No write path of any kind — this is 100% read-only; no `apps/worker` change, no Prisma migration, no remediation-processor change, no Graph call.
- No filtering/date-range query parameters (unlike `GovernanceAnalyticsQuery`) — this is a current-state snapshot, not a trend-over-time view; no historical "coverage over time" chart (would require a new persisted snapshot concept, out of scope).
- No caching layer — recomputed per request, matching `GovernanceAnalyticsService`.
- No redefinition of what counts as "acceptable ownership" — the existing `scoreOwnership` rule's conclusion is authoritative and unchanged.
- No new Prisma schema, no migration — confirmed unnecessary during this investigation (§3.3).

## 9. Risks

- **Coupling to `scoreOwnership`'s specific severity thresholds** (§3.1) — if that rule's scoring changes (e.g., a third failure mode is added, or severities are renumbered), this report's bucket-mapping logic needs re-verification. Mitigated by keeping the mapping in one small, well-tested function, not scattered.
- **In-memory bucketing at scale** — same, already-accepted risk class as `GovernanceAnalyticsService`'s own two in-memory metrics (§3.3); narrowly scoped fetches, not full-table, per that precedent.
- **A future site-count explosion** making `bySite` unwieldy — deferred, not preemptively solved (§6).

## 10. Future Phase B (documented for context only — not implementation scope)

If ownership coverage reporting reveals real, actionable gaps worth bulk-fixing, a second remediation action (`AssignOwnerAction`) is the natural follow-on, per the reusability audit performed before this ADR. Recorded here so the boundary is explicit before any such work begins:

- **Reuse unchanged, no duplication**: `RemediationJob`/`RemediationItem` schema, `REMEDIATION_QUEUE`, tenant-scoping/guards, both GET job endpoints, `BulkActionToolbar`, the selection-state mechanism (`selectedDocumentIds`), `useCreateRemediationJob`, the job list/detail/item-result UI (already renders any `issueType` generically).
- **Must become action-aware** (confirmed, not speculative, from direct code inspection): `remediation.processor.ts` needs a real dispatch step keyed on `remediationJob.issueType` (today it unconditionally calls `executeSetReviewDateAction` with no branching at all); the confirmation dialog needs an action-specific form (name/email fields, not a date picker) and copy; the eligibility predicate needs an `Ownership`-criterion counterpart to `isReviewStatusCandidate`.
- **Structurally simpler than `SetReviewDateAction`**: ownership assignment is, and is expected to remain, **entirely internal to Knowledge Health** — `DocumentOwner` is a governance/tracking signal (ADR-0007's domain model: *"ownership signal(s) for a document"*), not a mirror of a real SharePoint column the way the Review Date field is. A bulk `AssignOwnerAction` would perform **no Microsoft Graph write at all** — just a `DocumentOwner` insert per selected document, with no drive/list resolution, no PATCH, no targeted Graph re-fetch for verification. This makes it meaningfully lower-risk than `SetReviewDateAction` was, and would not need its own live-tenant Graph-write validation phase.
- **Not decided here**: whether bulk assignment is "assign one chosen owner to all selected documents" (the direct structural analog to `SetReviewDateAction`, and the most defensible default given `DocumentOwner`'s free-text-tag semantics) or something narrower like "assign to me." Whether to build this at all depends on what Phase A's actual reporting numbers show once it ships.
