import type { CriterionResult, ScoringInput } from '../types';
import { ISSUE_THRESHOLD } from '../config';
import { severityForScore } from './shared';

/**
 * ADR-0025: Taxonomy Quality V1 — classification COVERAGE, not validity.
 *
 * Measures whether the tenant-designated organizational classification
 * columns for this document's library are populated. Presence only: a value
 * being present is all that is checked — whether it is a valid/correct term
 * is explicitly out of scope for V1 (no Term Store validation). Content Type
 * and Managed Metadata are never treated as implicit classification signals;
 * only the columns the tenant explicitly designated count.
 *
 * Proportional coverage: score = round(100 * N / D), where D is the active
 * (non-stale) classification fields configured for the library and N is how
 * many are populated on this document. Stale fields are excluded by the
 * caller, so they never appear here.
 *
 * D = 0 (no classification policy configured for the library) is a neutral
 * 100 with NO issue — an unconfigured library is never penalized. The
 * "not configured" vs "measured 100% coverage" distinction is preserved at
 * the API/UI layer (a 100 here is genuinely indistinguishable in the score
 * alone, by design — the composite must not punish absence of a policy).
 *
 * Distinct from the Metadata criterion (intrinsic document hygiene); the two
 * share no inputs.
 */
export function scoreTaxonomy(input: ScoringInput): CriterionResult {
  const fields = input.classificationFields;

  // D = 0 → neutral, no issue. Never implies the document was classified.
  if (fields.length === 0) return { score: 100 };

  const populated = fields.filter((field) => field.populated);
  const score = Math.round((100 * populated.length) / fields.length);

  if (score >= ISSUE_THRESHOLD) return { score };

  const missing = fields.filter((field) => !field.populated).map((field) => field.displayName);
  return {
    score,
    issue: {
      type: 'Taxonomy',
      severity: severityForScore(score),
      message: `Document is missing ${missing.length} of ${fields.length} organizational classification field(s): ${missing.join(', ')}.`,
    },
  };
}
