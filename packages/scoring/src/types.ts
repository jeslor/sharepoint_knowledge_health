// Deliberately plain data types, not Prisma models — this package must be
// as ignorant of the database as packages/graph-client is of Prisma.

export type ScoringCriterion = 'Freshness' | 'Ownership' | 'ReviewStatus' | 'Metadata' | 'Duplication' | 'Age' | 'Taxonomy';
export type IssueSeverity = 'NeedsAttention' | 'RequiresReview';
export type HealthBand = 'Healthy' | 'NeedsAttention' | 'RequiresReview';

export interface DocumentOwnerInput {
  email: string | null;
  /**
   * null = unresolvable — DocumentOwner (Graph-sourced metadata) has no FK
   * to User, so "inactive owner" can only be detected for the subset of
   * owners whose email happens to match a registered User. This is a
   * documented, honest limitation, not a false-confidence signal.
   */
  isActiveUser: boolean | null;
}

export interface SiblingDocumentInput {
  id: string;
  name: string;
  sizeBytes: number;
}

/**
 * ADR-0025: one tenant-designated classification column, as it applies to a
 * single document. The caller passes only the ACTIVE (non-stale) fields
 * configured for the document's library — stale fields are excluded before
 * this input is built, so they never count toward the denominator.
 */
export interface ClassificationFieldInput {
  /** Stable Graph column definition id — the field's identity (never the display name). */
  columnDefinitionId: string;
  /** Human-readable name, for the issue message only (live Graph value, confirmation snapshot as fallback). */
  displayName: string;
  /**
   * Whether this document has a non-empty value for the field. Presence
   * only — V1 never inspects whether the value is a valid/correct term
   * (that is classification VALIDITY, explicitly out of scope). Null,
   * empty-string, whitespace-only, and empty multi-value all count as NOT
   * populated; the caller normalizes to this boolean.
   */
  populated: boolean;
}

export interface ScoringInput {
  documentId: string;
  documentName: string;
  sourceCreatedAt: Date;
  sourceModifiedAt: Date;
  sizeBytes: number;
  /**
   * ADR-0002 amendment (2026-08-13): the actual scheduled review date, not
   * a pre-computed boolean — scoreReviewStatus does its own date-vs-`now`
   * comparison (Missing/Overdue/Healthy) rather than the caller collapsing
   * that into "present or not" before this input is even constructed.
   */
  nextReviewDueAt: Date | null;
  owners: DocumentOwnerInput[];
  /** Other documents in the same tenant, for exact-match duplicate detection (ADR-0005). */
  siblingDocuments: SiblingDocumentInput[];
  /**
   * ADR-0025: the ACTIVE classification fields configured for this
   * document's library, each flagged populated/not. An empty array means no
   * classification policy is configured for the library (D = 0) → Taxonomy
   * scores a neutral 100 with no issue, never penalizing an unconfigured
   * library. Whether the library is configured at all is surfaced
   * separately at the API/UI layer, so "not configured" is never confused
   * with a measured 100% coverage.
   */
  classificationFields: ClassificationFieldInput[];
  /** Injectable for deterministic testing — defaults to the real current time. */
  now?: Date;
}

export interface Issue {
  type: ScoringCriterion;
  severity: IssueSeverity;
  message: string;
}

export interface CriterionResult {
  score: number;
  issue?: Issue;
}

export interface ScoreResult {
  score: number;
  band: HealthBand;
  issues: Issue[];
  breakdown: Record<ScoringCriterion, number>;
}
