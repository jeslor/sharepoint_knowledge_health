// See documents.ts header — same rationale (ADR-0009 shared API DTOs).
// ADR-0015 §4: both trend views read directly off data already persisted
// at write time (HealthSnapshot for org-level, HealthScore for
// per-document) — no new aggregation shape is computed here, only
// serialized.

export interface HealthTrendPoint {
  capturedAt: string;
  averageHealthScore: number | null;
  criticalIssuesCount: number;
  warningIssuesCount: number;
  totalDocumentsScanned: number;
}

export interface HealthTrendResponse {
  days: number;
  points: HealthTrendPoint[];
}

export interface DocumentScoreHistoryPoint {
  calculatedAt: string;
  score: number;
  band: string;
}

export interface DocumentScoreHistoryResponse {
  documentId: string;
  points: DocumentScoreHistoryPoint[];
}
