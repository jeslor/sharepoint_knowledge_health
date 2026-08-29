import type { CriterionResult, ScoringInput } from '../types';
import { severityForScore } from './shared';

const DUPLICATE_SCORE = 30;

/**
 * "Duplicate document detection -> reduce score." Exact-match only (name +
 * sizeBytes) per ADR-0005's deliberately basic MVP signal — fuzzy/content-
 * similarity matching is an explicit, deferred v2 feature, not a gap here.
 *
 * Name comparison is case/whitespace-normalized (trim, lowercase, collapse
 * runs of spaces/underscores/hyphens to a single space) so coincidental
 * formatting differences on an otherwise-identical filename still match.
 * The extension is deliberately NOT stripped and sizeBytes stays an exact
 * match — cross-extension/cross-format matches (e.g. the same content
 * saved as both .docx and .pdf) are a real but unresolved case: relaxing
 * the size match to catch them would reintroduce false positives this
 * codebase has no signal to rule out, so that remains out of scope here.
 */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

export function scoreDuplication(input: ScoringInput): CriterionResult {
  const normalizedName = normalizeName(input.documentName);
  const duplicates = input.siblingDocuments.filter(
    (sibling) =>
      sibling.id !== input.documentId && normalizeName(sibling.name) === normalizedName && sibling.sizeBytes === input.sizeBytes,
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
