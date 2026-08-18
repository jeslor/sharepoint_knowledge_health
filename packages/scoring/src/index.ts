export type {
  ScoringCriterion,
  IssueSeverity,
  HealthBand,
  DocumentOwnerInput,
  SiblingDocumentInput,
  ScoringInput,
  Issue,
  CriterionResult,
  ScoreResult,
} from './types';
export { SCORING_WEIGHTS, HEALTH_BANDS, ISSUE_THRESHOLD, SEVERITY_BANDS, REVIEW_DATE_DUE_SOON_WINDOW_DAYS } from './config';
export { calculateScore } from './calculate-score';
export { classifyReviewDateHealth } from './rules/review-status';
export type { ReviewDateHealthState } from './rules/review-status';
