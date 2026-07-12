import type { CriterionResult, ScoringInput } from '../types';
import { severityForScore } from './shared';

const PLACEHOLDER_NAME_SCORE = 30;

// Current Document schema only captures name/path/fileType/size — no
// title, description, or tags — so this is a deliberately modest,
// implementable-today heuristic (placeholder-looking file names), not a
// claim of full metadata-completeness analysis.
const PLACEHOLDER_NAME_PATTERNS = [/^untitled/i, /^new document/i, /^document\d*\.[a-z0-9]+$/i, /^copy of /i];

/** Best-effort metadata completeness signal, given today's schema fields. */
export function scoreMetadata(input: ScoringInput): CriterionResult {
  const looksLikePlaceholder = PLACEHOLDER_NAME_PATTERNS.some((pattern) => pattern.test(input.documentName.trim()));

  if (!looksLikePlaceholder) return { score: 100 };

  return {
    score: PLACEHOLDER_NAME_SCORE,
    issue: {
      type: 'Metadata',
      severity: severityForScore(PLACEHOLDER_NAME_SCORE),
      message: 'Document name appears to be an unedited placeholder, suggesting incomplete metadata.',
    },
  };
}
