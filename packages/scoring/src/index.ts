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
export { SCORING_WEIGHTS, HEALTH_BANDS, ISSUE_THRESHOLD, SEVERITY_BANDS } from './config';
export { calculateScore } from './calculate-score';
