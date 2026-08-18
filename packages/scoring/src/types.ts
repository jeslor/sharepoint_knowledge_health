// Deliberately plain data types, not Prisma models — this package must be
// as ignorant of the database as packages/graph-client is of Prisma.

export type ScoringCriterion = 'Freshness' | 'Ownership' | 'ReviewStatus' | 'Metadata' | 'Duplication' | 'Age';
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
