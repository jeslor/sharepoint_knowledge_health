import type { CriterionResult, ScoringInput } from '../types';

/** "Missing review date -> reduce score." */
export function scoreReviewStatus(input: ScoringInput): CriterionResult {
  if (input.hasReviewDate) return { score: 100 };

  return {
    score: 0,
    issue: {
      type: 'ReviewStatus',
      severity: 'RequiresReview',
      message: 'Document has no scheduled review date.',
    },
  };
}
