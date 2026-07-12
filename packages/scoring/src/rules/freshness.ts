import type { CriterionResult, ScoringInput } from '../types';
import { ISSUE_THRESHOLD } from '../config';
import { diffInDays, linearDecayScore, severityForScore } from './shared';

const FULL_SCORE_DAYS = 90;
const ZERO_SCORE_DAYS = 730;

/** "Document not modified recently -> reduce score." */
export function scoreFreshness(input: ScoringInput): CriterionResult {
  const now = input.now ?? new Date();
  const daysSinceModified = diffInDays(now, input.sourceModifiedAt);
  const score = linearDecayScore(daysSinceModified, FULL_SCORE_DAYS, ZERO_SCORE_DAYS);

  if (score >= ISSUE_THRESHOLD) return { score };

  return {
    score,
    issue: {
      type: 'Freshness',
      severity: severityForScore(score),
      message: `Document has not been modified in ${daysSinceModified} days.`,
    },
  };
}
