// See documents.ts header — same rationale (ADR-0009 shared API DTOs).

export interface ScanResponse {
  id: string;
  microsoftTenantId: string;
  // Phase 7B: null for a Scheduled scan — no human triggered it. See
  // triggerSource for which case this is, never inferred from nullness.
  triggeredByUserId: string | null;
  triggerSource: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  documentsScanned: number;
  documentsFailed: number;
  errorSummary: string | null;
  createdAt: string;
  // ADR-0015 §5 — live progress while Running, null/0 before the worker's
  // first update. Additive fields, backward compatible.
  totalSites: number | null;
  sitesCompleted: number;
  currentSiteName: string | null;
}

export interface TriggerScanRequest {
  microsoftTenantId?: string;
}

// Historical comparison (Phase 7C recommendation #5): highlight what
// changed between a scan and the one immediately before it, reusing the
// same HealthSnapshot/HealthScore/HealthIssue rows the scoring pipeline
// already writes — no new scoring, no recalculation.
export interface ScanComparisonIssue {
  documentId: string;
  documentName: string;
  criterion: string;
  severity: string;
  message: string;
}

export interface ScanComparisonResponse {
  scanId: string;
  previousScanId: string | null;
  scoreChange: number | null;
  criticalIssuesChange: number | null;
  warningIssuesChange: number | null;
  documentCountChange: number | null;
  newIssues: ScanComparisonIssue[];
  resolvedIssues: ScanComparisonIssue[];
}
