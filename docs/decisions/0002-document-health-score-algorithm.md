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
