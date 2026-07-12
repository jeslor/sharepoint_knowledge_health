import type {
  DocumentDetailResponse,
  DocumentHealthQuery,
  DocumentHealthResponse,
  DocumentResponse,
  HealthSummaryResponse,
  MeResponse,
  PaginatedResponse,
  ScanResponse,
  TriggerScanRequest,
} from '@sph/types';
import { apiRequest } from './client';

export function getMe(token: string): Promise<MeResponse> {
  return apiRequest('/auth/me', token);
}

// Minimal local shape (id + displayName only) — this reuses the existing
// Phase 5 admin-approval endpoint purely as a source of site filter
// options, not a new contract. The real response has more fields; TS's
// structural typing is fine with that here.
export interface SharePointSiteOption {
  id: string;
  displayName: string;
}

export function getSharePointSites(organizationId: string, token: string): Promise<SharePointSiteOption[]> {
  return apiRequest(`/organizations/${organizationId}/sharepoint-sites`, token);
}

function buildQueryString(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export function getHealthSummary(organizationId: string, token: string): Promise<HealthSummaryResponse> {
  return apiRequest(`/organizations/${organizationId}/health-summary`, token);
}

export function getDocuments(organizationId: string, token: string): Promise<DocumentResponse[]> {
  return apiRequest(`/organizations/${organizationId}/documents`, token);
}

export function getDocumentHealth(
  organizationId: string,
  token: string,
  query: DocumentHealthQuery = {},
): Promise<PaginatedResponse<DocumentHealthResponse>> {
  const queryString = buildQueryString(query);
  return apiRequest(`/organizations/${organizationId}/document-health${queryString}`, token);
}

export function getDocument(organizationId: string, documentId: string, token: string): Promise<DocumentDetailResponse> {
  return apiRequest(`/organizations/${organizationId}/documents/${documentId}`, token);
}

export function getScans(organizationId: string, token: string): Promise<ScanResponse[]> {
  return apiRequest(`/organizations/${organizationId}/scans`, token);
}

export function getScan(organizationId: string, scanId: string, token: string): Promise<ScanResponse> {
  return apiRequest(`/organizations/${organizationId}/scans/${scanId}`, token);
}

export function triggerScan(organizationId: string, token: string, body?: TriggerScanRequest): Promise<ScanResponse> {
  return apiRequest(`/organizations/${organizationId}/scans`, token, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}
