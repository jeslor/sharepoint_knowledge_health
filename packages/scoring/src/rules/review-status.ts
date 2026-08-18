import type { CriterionResult, ScoringInput } from '../types';
import { REVIEW_DATE_DUE_SOON_WINDOW_DAYS, REVIEW_STATUS_OVERDUE_SCORE } from '../config';
import { diffInDays, severityForScore } from './shared';

/**
 * ADR-0002 amendment (2026-08-13): Missing (no date at all) scores worse
 * than Overdue (a cadence exists, it's just lapsed) — 0 vs.
 * REVIEW_STATUS_OVERDUE_SCORE (50) preserves that ordering while landing
 * each in the severity band its score already implies via
 * severityForScore (Missing < 40 -> RequiresReview; Overdue in 40-69 ->
 * NeedsAttention), reusing the existing two-tier scale rather than
 * inventing a new one.
 */
export function scoreReviewStatus(input: ScoringInput): CriterionResult {
  const now = input.now ?? new Date();

  if (input.nextReviewDueAt === null) {
    return {
      score: 0,
      issue: {
        type: 'ReviewStatus',
        severity: 'RequiresReview',
        message: 'Document has no scheduled review date.',
      },
    };
  }

  if (input.nextReviewDueAt < now) {
    return {
      score: REVIEW_STATUS_OVERDUE_SCORE,
      issue: {
        type: 'ReviewStatus',
        severity: severityForScore(REVIEW_STATUS_OVERDUE_SCORE),
        message: 'Document review date has passed.',
      },
    };
  }

  return { score: 100 };
}

export type ReviewDateHealthState = 'Missing' | 'Overdue' | 'DueSoon' | 'Healthy';

/**
 * ADR-0002 amendment (2026-08-13): the presentation-layer counterpart to
 * scoreReviewStatus above — "Due Soon" deliberately has no representation
 * in the scoring output (no HealthIssue, no score reduction; a
 * soon-due document is still `Healthy` per scoreReviewStatus). This
 * function exists so a UI can classify the same nextReviewDueAt value
 * into a fourth, purely informational state at read time, without the
 * scoring engine ever needing to know "soon" is a concept. Never
 * persisted; not currently wired into any API response or component
 * (deferred — see the Phase 3A-1 report).
 */
export function classifyReviewDateHealth(
  nextReviewDueAt: Date | null,
  now: Date,
  dueSoonWindowDays: number = REVIEW_DATE_DUE_SOON_WINDOW_DAYS,
): ReviewDateHealthState {
  if (nextReviewDueAt === null) return 'Missing';
  if (nextReviewDueAt < now) return 'Overdue';
  if (diffInDays(nextReviewDueAt, now) <= dueSoonWindowDays) return 'DueSoon';
  return 'Healthy';
}
