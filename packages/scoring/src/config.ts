import type { ScoringCriterion } from './types';

// ADR-0002 MVP weights — named constants, not magic numbers scattered
// through rule logic, so v2 per-organization configurability is a
// data-source change later, not an engine rewrite.
export const SCORING_WEIGHTS: Record<ScoringCriterion, number> = {
  Freshness: 0.3,
  Ownership: 0.2,
  ReviewStatus: 0.15,
  Metadata: 0.15,
  Duplication: 0.1,
  Age: 0.1,
};

export const HEALTH_BANDS = {
  HEALTHY_MIN: 90,
  NEEDS_ATTENTION_MIN: 70,
};

/** A HealthIssue is generated whenever a sub-score falls below this (ADR-0002). */
export const ISSUE_THRESHOLD = 70;

/** ADR-0002 amendment (2026-07-12): how a sub-70 sub-score maps to a severity. */
export const SEVERITY_BANDS = {
  NEEDS_ATTENTION_MIN: 40, // 40-69 -> NeedsAttention, below 40 -> RequiresReview
};
