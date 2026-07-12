// See documents.ts header — same rationale (ADR-0009 shared API DTOs).

export interface ScanResponse {
  id: string;
  microsoftTenantId: string;
  triggeredByUserId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  documentsScanned: number;
  documentsFailed: number;
  errorSummary: string | null;
  createdAt: string;
}

export interface TriggerScanRequest {
  microsoftTenantId?: string;
}
