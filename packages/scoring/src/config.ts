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

/**
 * ADR-0002 amendment (2026-08-13): ReviewStatus's Overdue sub-score —
 * lands in the existing 40-69 NeedsAttention band (via SEVERITY_BANDS
 * above), deliberately higher than Missing's 0 (a lapsed cadence is
 * judged less severe than no cadence ever having existed).
 */
export const REVIEW_STATUS_OVERDUE_SCORE = 50;

/**
 * ADR-0002 amendment (2026-08-13): how many days out "Due Soon" looks —
 * presentation-only (see rules/review-status.ts's classifyReviewDate),
 * never affects the scored Overdue/Healthy outcome. Chosen as a
 * proportionate default for typical enterprise review cadences
 * (commonly quarterly/annual) — not derived from customer data, since
 * none exists yet; revisit if real usage shows it's poorly calibrated.
 */
export const REVIEW_DATE_DUE_SOON_WINDOW_DAYS = 30;
