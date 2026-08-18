import type { GraphColumnDefinition } from '@sph/graph-client';

export type ReviewDateCandidateConfidence = 'high' | 'medium' | 'low' | 'ambiguous';

// Strips everything except letters/digits and lowercases, so "Review Date",
// "review_date", "ReviewDate", "Review-Date", and "REVIEW DATE" all
// normalize identically before any matching happens — one deterministic
// rule, not a growing pile of special-cased spellings.
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Excludes "preview" specifically — the one realistic English word that
// contains "review" as a substring. Deliberately narrow (this is not a
// general word-boundary tokenizer): SharePoint internal column names are
// routinely concatenated with no separator at all ("ReviewDate",
// "REVIEWDATE"), which rules out a `\bword\b`-style regex working
// reliably across both internal name and display name — a targeted
// exclusion for the one known false positive is simpler and just as
// explainable as a full tokenizer would be.
const REVIEW_PATTERN = /(?<!p)review/;

// Any of these, alongside "review", is enough to call a column a
// confident date-of-review match — covers every realistic phrasing
// (Review Date, Next Review Date, Review Due Date, Date for Review,
// Document Review Date, Review Deadline, Date To Review, "Next Review").
const DATE_INDICATOR_PATTERN = /date|due|deadline|next|when/;

/**
 * Display-only ranking for the admin selection UI (Phase 2+) — NEVER
 * consumed by resolveReviewDateCandidates or the confirm/activation path.
 * A "high" confidence single candidate still requires the exact same
 * explicit admin confirmation as any other; a "high" confidence candidate
 * among several eligible ones does not make activation any less
 * ambiguous. This function only helps a human choose faster once they're
 * already looking at a list — it never chooses for them, and its result
 * is never persisted.
 *
 * Deterministic, explainable two-signal rule (ADR-0016 §17.2/§17.4):
 * - Contains "review" AND a date-indicator word -> high (e.g. "Review
 *   Date", "ReviewDueDate", "Document Review Date").
 * - Contains "review" but no date-indicator word -> ambiguous (e.g.
 *   "Document Review" — could denote a review *outcome*, not a date; a
 *   human must judge it, never auto-selected regardless of tier).
 * - No "review", but an expiry/renewal/due/deadline word -> medium.
 * - Otherwise -> low.
 *
 * No LLM/AI — this is a small, closed vocabulary problem, not open-ended
 * language understanding, and a fixed deterministic rule is exactly as
 * explainable to an IT admin as a model's output would be uncertain.
 */
export function scoreReviewDateCandidateConfidence(column: GraphColumnDefinition): ReviewDateCandidateConfidence {
  const normalized = normalize(`${column.name} ${column.displayName}`);

  if (REVIEW_PATTERN.test(normalized)) {
    return DATE_INDICATOR_PATTERN.test(normalized) ? 'high' : 'ambiguous';
  }
  if (/expir|renew|due|deadline/.test(normalized)) return 'medium';
  return 'low';
}
