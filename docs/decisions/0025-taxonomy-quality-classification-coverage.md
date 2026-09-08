# ADR-0025: Taxonomy Quality — Classification Coverage (V1)

Date: 2026-09-08
Status: Accepted (2026-09-08) — implemented for the scoring/collection/persistence/governance engine; the admin configuration API and UI are the remaining increment (see §9).

---

## 1. Problem Statement

`docs/product/roadmap.md` lists "Taxonomy Quality" as a Version 2 item with no definition. A read-only investigation (2026-09-08) confirmed the repository defined no metric, collected no taxonomy data, and had no scoring/issue surface for it — and that ADR-0021 §8 had already flagged the item as possibly not net-new. The one product mission pillar (`.claude/context/project.md`) with **no** dedicated criterion is **discoverable** (accurate/current/owned/trustworthy are already covered by existing criteria); classification is what serves discoverability. This ADR records the product decision that turns the vague roadmap word into one precise, measurable criterion.

## 2. Product Decision (owner-approved, 2026-09-08)

1. **Coverage, not validity.** V1 measures whether the organization's designated classification fields are **populated** — presence only. Whether a value is a *valid/correct* term is explicitly out of scope (no Term Store validation).
2. **Tenant-designated columns define "classification."** The tenant explicitly designates which SharePoint columns constitute its classification scheme. Content Type and Managed Metadata usage are **never** treated as implicit classification signals — a non-default content type is not assumed "better."
3. **Boundary with Metadata:** **Metadata = intrinsic document hygiene** (filename/placeholder); **Taxonomy = organizational classification** (designated columns populated). The Metadata criterion is not expanded; the two share no inputs or code.

## 3. Decision

### 3.1 Configuration model — `SharePointClassificationField`
Per-library, mirroring `SharePointReviewDateMapping`: one row per designated column per library, keyed on the stable `columnDefinitionId` (never the display name), `columnDisplayNameAtConfirmation` stored as provenance/fallback only. `status` `Active`/`Stale` with `staleDetectedAt`, `confirmedByUser` (Restrict). `@@unique([siteId, graphListId, columnDefinitionId])` — a library may have multiple classification fields.

### 3.2 Coverage semantics (the five approved decisions)
- **Weights (decision 1):** a seventh criterion `Taxonomy` at **10%**, funded by Freshness 30→25% and Age 10→5%; the seven weights still sum to exactly 1.0. One-time customer-visible composite shift on the first post-deploy scan.
- **Proportional coverage (decision 2):** `score = round(100 × N / D)`, where `D` = active (non-stale) classification fields configured for the document's library and `N` = how many are populated. A `Taxonomy` `HealthIssue` is generated below the 70 threshold, severity via the existing bands; the message names the missing fields.
- **D = 0 (decision 3):** no classification policy configured → Taxonomy contributes a **neutral 100** with no issue; an unconfigured library is never penalized. The "not configured" vs "measured 100% coverage" distinction is preserved at the API/UI layer (never inferred from the 100 alone).
- **Historical rows (decision 4):** `HealthScore.taxonomyScore` is **nullable** — a null means "Taxonomy was never evaluated for this scan," never a fabricated 100. No `DEFAULT` backfill. New scans populate 0–100.
- **Stale fields (decision 5):** a designated column that no longer resolves in Graph is marked `Stale` and excluded from the denominator; a stale column that resolves again is re-activated — the same lifecycle as review-date sync.

### 3.3 Data & collection (read-only, no new Graph scope)
Within the existing `Sites.Read.All`. Config candidate discovery reuses `listColumns`/`listContentTypes`. Per-document values use `listItemFields` (extended to select multiple columns in one `$select`) joined to `Document.graphItemId` via `listItemDriveItemIds` — the exact flat, non-N+1 sweep review-date sync uses. Column *values* are metadata; the metadata-only ingestion principle is preserved (no document content downloaded). A Graph failure for one library leaves its documents unmeasured (neutral), never failing the scan. Raw classification values are **not** persisted — coverage is computed at scan time; only `taxonomyScore` is stored, exactly like every other criterion's raw inputs.

## 4. Amendment to ADR-0002
This ADR is also the ADR-0002 amendment adding the seventh criterion and re-balancing the weights (§3.2). Recorded as a dated amendment in ADR-0002 itself.

## 5. Explicit non-goals (V1)
No Term Store / controlled-vocabulary validation; Content Type and Managed Metadata never used as implicit classification signals; no automatic classification; no SharePoint write-back; no per-document dynamic weight normalization; no expansion of the Metadata criterion.

## 6. Consequences
- New per-library config surface and a new per-library value sweep; new scoring criterion; additive schema (`SharePointClassificationField`, nullable `HealthScore.taxonomyScore`, `HealthIssueCriterion.Taxonomy`). Taxonomy issues flow through the existing generic governance loop, analytics bucket, issue guidance, and filters with no special-casing.
- Weights remain provisional (ADR-0002's own stance); revisit after pilot data.

## 7. Tenant isolation / determinism / permission model
The new repository joins the central tenant-isolation sweep. The scoring rule is pure/deterministic (populated flags resolved by the caller, passed in). No new Graph permission is requested.

## 8. Risks
- **Config burden:** the metric is undefined until a tenant designates columns — mitigated by the D=0 neutral rule (no penalty pre-configuration).
- **Rollout shift:** one-time composite change on first scan after deploy (flag to customers/support), matching ADR-0002's precedent.
- **Single-document rescore** (`rescore-document.ts`, ADR-0022) does not re-measure taxonomy (compute-only, consulted per remediated criterion; Taxonomy is not a remediation target) — an accepted, documented limitation.

## 9. Implementation status (2026-09-08)
Implemented and validated: schema + migration; scoring rule + weights + composite; multi-column Graph read; database repository + tenant-isolation coverage; worker collection/join + Active/Stale lifecycle + `taxonomyScore` persistence; `@sph/types` criterion + labels; generic web governance integration (issue guidance, critical-issues card). **Remaining increment:** the admin configuration API (designate/list/remove classification fields per library) and its designation UI, plus the document-detail taxonomy badge and the "not configured vs 100% covered" presentation state — to be built next, reusing the review-date candidate/confirm pattern.
