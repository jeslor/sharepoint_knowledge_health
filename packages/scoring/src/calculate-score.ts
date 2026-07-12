import type { CriterionResult, HealthBand, Issue, ScoreResult, ScoringCriterion, ScoringInput } from './types';
import { HEALTH_BANDS, SCORING_WEIGHTS } from './config';
import { scoreFreshness } from './rules/freshness';
import { scoreOwnership } from './rules/ownership';
import { scoreReviewStatus } from './rules/review-status';
import { scoreMetadata } from './rules/metadata';
import { scoreDuplication } from './rules/duplication';
import { scoreAge } from './rules/age';

/**
 * Composes the 6 isolated rules into a weighted composite score, band, and
 * issue list (ADR-0002). Deterministic — same input always produces the
 * same output, no external state or randomness. Adding a 7th rule later is
 * mechanical: one more entry here, in the weights, and in the breakdown —
 * no existing rule needs to change.
 */
export function calculateScore(input: ScoringInput): ScoreResult {
  const results: Record<ScoringCriterion, CriterionResult> = {
    Freshness: scoreFreshness(input),
    Ownership: scoreOwnership(input),
    ReviewStatus: scoreReviewStatus(input),
    Metadata: scoreMetadata(input),
    Duplication: scoreDuplication(input),
    Age: scoreAge(input),
  };

  const breakdown: Record<ScoringCriterion, number> = {
    Freshness: results.Freshness.score,
    Ownership: results.Ownership.score,
    ReviewStatus: results.ReviewStatus.score,
    Metadata: results.Metadata.score,
    Duplication: results.Duplication.score,
    Age: results.Age.score,
  };

  const issues: Issue[] = Object.values(results)
    .map((result) => result.issue)
    .filter((issue): issue is Issue => issue !== undefined);

  const weightedTotal =
    breakdown.Freshness * SCORING_WEIGHTS.Freshness +
    breakdown.Ownership * SCORING_WEIGHTS.Ownership +
    breakdown.ReviewStatus * SCORING_WEIGHTS.ReviewStatus +
    breakdown.Metadata * SCORING_WEIGHTS.Metadata +
    breakdown.Duplication * SCORING_WEIGHTS.Duplication +
    breakdown.Age * SCORING_WEIGHTS.Age;

  const score = Math.round(weightedTotal);
  const band: HealthBand =
    score >= HEALTH_BANDS.HEALTHY_MIN ? 'Healthy' : score >= HEALTH_BANDS.NEEDS_ATTENTION_MIN ? 'NeedsAttention' : 'RequiresReview';

  return { score, band, issues, breakdown };
}
