import type { CriterionResult, ScoringInput } from '../types';
import { severityForScore } from './shared';

const DUPLICATE_SCORE = 30;

/**
 * "Duplicate document detection -> reduce score." Exact-match only (name +
 * sizeBytes) per ADR-0005's deliberately basic MVP signal — fuzzy/content-
 * similarity matching is an explicit, deferred v2 feature, not a gap here.
 */
export function scoreDuplication(input: ScoringInput): CriterionResult {
  const duplicates = input.siblingDocuments.filter(
    (sibling) => sibling.id !== input.documentId && sibling.name === input.documentName && sibling.sizeBytes === input.sizeBytes,
  );

  if (duplicates.length === 0) return { score: 100 };

  return {
    score: DUPLICATE_SCORE,
    issue: {
      type: 'Duplication',
      severity: severityForScore(DUPLICATE_SCORE),
      message: `Document appears to be a duplicate of ${duplicates.length} other document(s) with the same name and size.`,
    },
  };
}
