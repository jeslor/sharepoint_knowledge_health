import type { GraphColumnDefinition } from '@sph/graph-client';

export type ReviewDateCandidateConfidence = 'high' | 'medium' | 'low';

/**
 * Display-only ranking for a future admin selection UI (Phase 2+) —
 * NEVER consumed by resolveReviewDateCandidates or the confirm/activation
 * path. A "high" confidence single candidate still requires the exact
 * same explicit admin confirmation as a "low" confidence one; a "high"
 * confidence candidate among several eligible ones does not make
 * activation any less ambiguous. This function only helps a human choose
 * faster once they're already looking at a list — it never chooses for
 * them, and its result is never persisted.
 */
export function scoreReviewDateCandidateConfidence(column: GraphColumnDefinition): ReviewDateCandidateConfidence {
  const text = `${column.name} ${column.displayName}`.toLowerCase();
  if (text.includes('review')) return 'high';
  if (/expir|renew|due|deadline/.test(text)) return 'medium';
  return 'low';
}
