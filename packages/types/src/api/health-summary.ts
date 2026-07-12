// See documents.ts header — same rationale (ADR-0009 shared API DTOs).
// Named health-summary (not health.ts, already taken by the liveness
// HealthStatus check) to avoid confusion between the two unrelated concepts.

export interface HealthSummaryResponse {
  totalDocumentsScanned: number;
  averageHealthScore: number | null;
  criticalIssuesCount: number;
  warningIssuesCount: number;
  lastSuccessfulScanAt: string | null;
  currentScanStatus: string | null;
}
