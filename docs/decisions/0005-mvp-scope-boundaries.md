# ADR-0005: MVP Scope Boundaries (Duplication Detection)

Date: 2026-07-11
Status: Accepted

---

## Problem

`docs/product/roadmap.md` lists "Duplicate Detection" as a standalone Version 2 feature, but `docs/features/document-health-score.md` lists "duplication" as one of the six criteria the MVP scan must evaluate. These two documents directly conflict on whether duplication is in or out of MVP scope.

## Context

- True duplicate detection (content hashing, fuzzy similarity matching across renamed/edited copies) is a nontrivial feature in its own right — it's reasonable that the roadmap treats it as a dedicated v2 initiative.
- The health score algorithm (ADR-0002) still needs *some* signal for "duplication" if MVP scoring is to honor what `document-health-score.md` promises.
- Engineering principles favor simple solutions and avoiding over-engineering MVP features.

## Options Considered

**A. Full content-based duplicate detection in MVP**
Hashing/embedding-based similarity across the tenant's full document set. High effort, meaningfully overlaps with what's already planned as a dedicated v2 feature — building it twice, or building the complex version prematurely.

**B. Basic duplication heuristic in MVP; full detection remains v2**
MVP scoring uses a cheap, exact-match signal (identical file name + file size, or exact content hash if available from Graph metadata) as one input to the composite score. Clearly labeled as a basic check in the UI. The v2 roadmap item becomes the fuzzy/similarity-based upgrade to this same signal.

**C. Drop duplication from MVP scoring entirely**
Resolves the conflict by editing `document-health-score.md` to remove the criterion. Simplest, but breaks the existing product spec's promise without a clear reason, and removes a criterion that's cheap to approximate.

## Recommended Decision

**Option B.** MVP includes a basic, exact-match duplication signal as one of the six scoring criteria. Full similarity/fuzzy duplicate detection remains the dedicated v2 "Duplicate Detection" roadmap feature, which will later replace or upgrade this signal.

This resolves the documentation conflict without dropping a promised criterion, and keeps the MVP algorithm implementation simple and boundable.

## Tradeoffs

- A basic exact-match check will miss near-duplicates — renamed copies, minor edits, documents saved to two different libraries with different names. This is an accepted limitation for MVP, explicitly surfaced as "basic" in the UI so it isn't mistaken for the full v2 capability.
- Keeps MVP scoring logic simple and fast to compute (no embeddings, no cross-document similarity comparison), matching "optimize after measuring" and "avoid over-engineering."

## Future Considerations

- v2 Duplicate Detection feature upgrades this signal to content-similarity/embedding-based comparison and can retroactively re-score existing documents once live.
- When v2 ships, update the health score algorithm (ADR-0002) weight/rationale for the duplication criterion rather than introducing a separate score.
