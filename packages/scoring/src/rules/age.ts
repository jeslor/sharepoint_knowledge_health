import type { CriterionResult, ScoringInput } from '../types';
import { ISSUE_THRESHOLD } from '../config';
import { diffInDays, linearDecayScore, severityForScore } from './shared';

const FULL_SCORE_DAYS = 365;
const ZERO_SCORE_DAYS = 1825;

/**
 * Document age since creation — distinct from Freshness (time since last
 * modification). An old-but-frequently-updated document scores well here
 * even if it also has a Freshness issue for an unrelated reason.
 */
export function scoreAge(input: ScoringInput): CriterionResult {
  const now = input.now ?? new Date();
  const daysSinceCreated = diffInDays(now, input.sourceCreatedAt);
  const score = linearDecayScore(daysSinceCreated, FULL_SCORE_DAYS, ZERO_SCORE_DAYS);

  if (score >= ISSUE_THRESHOLD) return { score };

  return {
    score,
    issue: {
      type: 'Age',
      severity: severityForScore(score),
      message: `Document is ${daysSinceCreated} days old and has not been reviewed for continued relevance.`,
    },
  };
}
