// See documents.ts header — same rationale (ADR-0009 shared API DTOs).

export interface MeResponse {
  id: string;
  role: string;
  organizationId: string;
}
