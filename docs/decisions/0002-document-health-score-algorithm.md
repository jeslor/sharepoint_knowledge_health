# ADR-0002: Document Health Score Algorithm

Date: 2026-07-11
Status: Accepted (updated 2026-07-11 with MVP weights and thresholds)

---

## Problem

`docs/features/document-health-score.md` specifies *what* the scan must evaluate — freshness, owner, review status, metadata, duplication, document age — but not *how* those signals combine into the single numerical score shown on the dashboard.

## Context

- Product philosophy is "knowledge quality before AI" and governance-focused — customers need to trust and understand the score, not just receive a number.
- The dashboard also shows issues, recommendations, and historical trends per `document-health-score.md`, meaning the score must decompose into explainable parts, not just a single opaque figure.
- No training data or customer scoring history exists yet, ruling out data-driven approaches for MVP.

## Options Considered

**A. Single opaque weighted formula**
One score computed from a black-box combination of signals. Fast to build but fails the "trustworthy" and "actionable recommendations" requirements — customers can't see why a document scored poorly.

**B. Rule-based, per-criterion scoring with transparent composite**
Each criterion (freshness, owner, review status, metadata completeness, duplication, age) produces its own 0–100 sub-score plus a human-readable reason. Sub-scores combine via fixed, documented weights into a single 0–100 composite health score. Issues and recommendations fall directly out of whichever sub-scores are low.

**C. ML/statistical scoring (anomaly detection, learned weights)**
No labeled data or usage history exists to train or validate this yet. Adds significant complexity and unpredictability for no proven benefit at MVP stage — directly conflicts with "do not over-engineer MVP features" and "do not add AI features unless they provide measurable business value."

## Recommended Decision

**Option B.** Build a rule-based scoring engine as a pure, independently testable service:

- Each criterion is a separate scoring function returning `{ score: 0-100, issues: Issue[] }`.
- Composite score = weighted average of sub-scores. Weights are named constants in code (not user-configurable in MVP), documented alongside the algorithm.
- Duplication uses the basic signal defined in ADR-0005, not full similarity detection.
- Every sub-score that falls below a threshold generates a recommendation surfaced on the dashboard.

### MVP Weights

| Criterion              | Weight |
|-------------------------|--------|
| Freshness                | 30%   |
| Ownership                | 20%   |
| Review Status             | 15%   |
| Metadata Completeness     | 15%   |
| Duplication (basic signal, ADR-0005) | 10% |
| Document Age              | 10%   |

Composite score = sum of `(sub-score × weight)` across all six criteria, producing a single 0–100 value.

### Health Bands

| Range   | Label            |
|---------|------------------|
| 90–100  | Healthy          |
| 70–89   | Needs Attention  |
| < 70    | Requires Review  |

Bands classify the **composite** score for dashboard display (e.g., badge color/label).

### Issue Generation

A `HealthIssue` (see ADR-0007) is generated whenever an individual **criterion sub-score** — not the composite — falls below 70. This means a document can sit in the "Healthy" composite band while still surfacing an issue on one weak criterion; that's intentional, since the goal is actionable per-criterion recommendations, not just a single pass/fail gate.

**Amendment (2026-07-12, Phase 5 implementation)**: this ADR never specified how a sub-70 sub-score maps to one of `HealthIssueSeverity`'s two values (`NeedsAttention`, `RequiresReview`) — needed once the scoring engine (`packages/scoring`) was actually implemented. Decided: **40–69 → `NeedsAttention`, below 40 → `RequiresReview`**, mirroring the same two-tier structure already used for the composite `HealthBand` rather than inventing a separate scale.

### Configurability Design

Weights and thresholds are hardcoded for MVP but must not be scattered as magic numbers inside the scoring functions. Structure:

- A single `scoring-config` module exports a `ScoringWeights` object and a `HealthBands` / `IssueThreshold` object as named constants.
- Each per-criterion scoring function is pure and knows nothing about weights or bands — it only returns a 0–100 sub-score plus issue detail.
- A separate composite-calculation step consumes the config object and the sub-scores to produce the final score, band, and issue list.

This keeps the weights/thresholds as data, not logic, so v2's per-organization configurability (see below) becomes "load this config from the database per `organizationId` instead of importing the constant" — no rewrite of the scoring functions themselves.

## Tradeoffs

- Rule-based scoring is simple, fast to build, fully unit-testable, and explainable — but the initial weights are a hypothesis, not a validated model. Customers may disagree with what's weighted heavily.
- Treat the first weight set as provisional and expect to tune it after pilot customer feedback, not as a final answer.

## Future Considerations

- v2: allow per-organization weight and threshold configuration once there's evidence different customers value criteria differently — the config-object design above makes this a data-source change, not an engine rewrite.
- v2: replace the basic duplication signal with the full Duplicate Detection feature (ADR-0005) as an input.
- Consider exposing the scoring rationale via API so it can be audited or exported, reinforcing the "governance not generation" positioning.

---

## Amendment (2026-07-13, Phase 8 review — Accepted 2026-07-23)

**Amendment status: Accepted and implemented (2026-07-23).** This section
proposed a change to a scoring *input*, separate from ADR-0016 (Document
Governance Actions and Issue Management), which referenced this amendment
but deliberately did not implement it — see ADR-0016 §10 (Scope
Discipline) and §13 (Phase 8A was schema-only for review metadata; this
amendment is what wires that schema into scoring).

**Implementation note (2026-07-23):** `hasReviewDate` now reads
`document.nextReviewDueAt !== null` at the same call site
(`apps/worker/src/queue/document-collector.processor.ts`), exactly as
proposed below — no other change to `scoreReviewStatus` or its 15% weight.
Since nothing previously wrote `Document.nextReviewDueAt`, a minimal write
path was added at the same time: `PATCH
/organizations/:id/documents/:documentId/review` (Admin/GovernanceManager,
matching ADR-0016 §4.6/§7's already-proposed shape), always stamping
`reviewDateSource: Manual` — the only source that exists until a future,
separately-decided Graph List Items API integration (ADR-0016 §9).

### Current behavior

`ReviewStatus`'s scoring input, `hasReviewDate: boolean`, is **hardcoded to
`false`** at the single call site that constructs it
(`apps/worker/src/queue/document-collector.processor.ts:277`). The
surrounding code comment states this plainly: *"Graph's driveItem endpoint
has no native 'review date' — that's a SharePoint custom list column,
which requires the separate List Items API (out of scope here).
`hasReviewDate` is always `false` until that's built, so every document
currently reports a ReviewStatus issue. This is a real gap, not a
placeholder oversight."*

The scoring rule itself (`packages/scoring/src/rules/review-status.ts`)
is simple and unchanged by anything in this amendment:

```typescript
export function scoreReviewStatus(input: ScoringInput): CriterionResult {
  if (input.hasReviewDate) return { score: 100 };
  return { score: 0, issue: { type: 'ReviewStatus', severity: 'RequiresReview', message: 'Document has no scheduled review date.' } };
}
```

Because the input is always `false`, this function has returned `{ score:
0, issue: {...} }` for **every document ever scored**, unconditionally,
since Phase 5. There is no code path today that can produce `score: 100`
for this criterion.

### Why it is inaccurate

`ReviewStatus` is meant to measure something real and variable: does this
document have an established review cadence, yes or no. As implemented,
it measures nothing — it is a constant, not a signal. Concretely, this
means, for every organization using the product today:

- The `ReviewStatus` sub-score contributes its full 15% weight (ADR-0002's
  MVP Weights table) to every composite score as a fixed 0, uniformly
  depressing every document's composite score by the same amount,
  regardless of the document's actual governance quality.
- Every scored document generates a `RequiresReview`-severity
  `HealthIssue` for `ReviewStatus`, unconditionally — inflating the
  critical-issue counts surfaced on the dashboard (`HealthSummaryResponse`,
  `HealthTrendResponse`) with an issue type that carries zero
  discriminating information between a well-governed document and a
  neglected one.
- Nothing about this is visible as a "known limitation" anywhere a customer
  would see it — the dashboard presents it as a real finding, indistinguishable
  from the other five criteria's genuine signals.

### Future review date sources

Two sources, deliberately given the same `source`-tagged shape ADR-0007
already established for `DocumentOwner` (`GraphMetadata` vs.
`ManualAssignment`), so this isn't a new pattern:

1. **`Manual`** — a customer or admin sets `Document.nextReviewDueAt`
   directly inside the application (proposed schema, ADR-0016 §6). This is
   the only source available in the near term, since it requires no new
   Graph capability.
2. **`GraphMetadata`** — sourced from a SharePoint custom list/library
   column via the Microsoft Graph **List Items API**, which
   `packages/graph-client` does not implement today (ADR-0013 §8 exposes
   only `listSites`/`listDrives`/`listDocuments`/`getSite`/`getDrive`/
   `getDocument` — no list-item surface). Adding this is a distinct,
   future integration decision (ADR-0016 §9), not part of this amendment.

### Scoring impact

**The scoring rule (`scoreReviewStatus`) and its weight (15%, per the MVP
Weights table above) are unchanged by this amendment.** What changes is
only the value the worker passes as `hasReviewDate`:

- **Before**: `hasReviewDate: false` (hardcoded constant).
- **Proposed**: `hasReviewDate: document.nextReviewDueAt !== null` — "has
  any review date been established at all," preserving the rule's existing
  binary shape and stated rationale ("missing review date → reduce
  score") exactly, just backed by a real field instead of a stub.

Deliberately **not** proposed by this amendment: distinguishing "has a
review date" from "review date has not yet passed" (i.e., an
overdue-vs-scheduled distinction within the score itself). That would be a
genuine algorithm change — a new condition, not a new input — and is left
as an explicit open question for a future amendment if there's evidence
it's needed, not decided here.

**Rollout impact, if accepted and implemented**: the first scan to run
after this change deploys will shift every organization's average health
score and `ReviewStatus` issue counts as a one-time step function —
documents with a manually-set review date will newly pass; documents
without one will continue failing, exactly as today. This is an expected,
one-time correction (matching this same ADR's own precedent of treating
weight/threshold changes as a customer-visible event, per "Treat the first
weight set as provisional"), not a regression — but should be flagged to
customers/support as a known one-time scoring shift when it ships.

### Explicit scope note

This amendment is **not implemented by Phase 8A/8B/8C/8D**. Phase 8A adds
the `Document.nextReviewDueAt`/`reviewDateSource` schema (ADR-0016 §6) but
does **not** wire it into `hasReviewDate` — that wiring only happens once
this amendment itself is separately reviewed and accepted, keeping
governance-feature delivery and scoring-input changes on two independent
approval tracks, per the explicit instruction to keep them separate.
