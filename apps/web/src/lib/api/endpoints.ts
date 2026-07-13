import type {
  AssignableUserResponse,
  AssignDocumentOwnerRequest,
  CreateGovernanceIssueRequest,
  CreateScanScheduleRequest,
  DocumentDetailResponse,
  DocumentHealthQuery,
  DocumentHealthResponse,
  DocumentOwnerResponse,
  DocumentResponse,
  DocumentScoreHistoryResponse,
  GovernanceActivityListQuery,
  GovernanceActivityResponse,
  GovernanceAnalyticsQuery,
  GovernanceAnalyticsResponse,
  GovernanceIssueListQuery,
  GovernanceIssueResponse,
  GovernanceSummaryResponse,
  HealthSummaryResponse,
  HealthTrendResponse,
  MeResponse,
  PaginatedResponse,
  ScanComparisonResponse,
  ScanResponse,
  ScanScheduleResponse,
  TriggerScanRequest,
  UpdateGovernanceIssueRequest,
  UpdateScanScheduleRequest,
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

export function getDocumentHistory(
  organizationId: string,
  documentId: string,
  token: string,
): Promise<DocumentScoreHistoryResponse> {
  return apiRequest(`/organizations/${organizationId}/documents/${documentId}/history`, token);
}

export function getHealthTrends(organizationId: string, token: string, days?: number): Promise<HealthTrendResponse> {
  const queryString = days !== undefined ? buildQueryString({ days }) : '';
  return apiRequest(`/organizations/${organizationId}/health-trends${queryString}`, token);
}

export function getScans(organizationId: string, token: string): Promise<ScanResponse[]> {
  return apiRequest(`/organizations/${organizationId}/scans`, token);
}

export function getScan(organizationId: string, scanId: string, token: string): Promise<ScanResponse> {
  return apiRequest(`/organizations/${organizationId}/scans/${scanId}`, token);
}

export function getScanComparison(organizationId: string, scanId: string, token: string): Promise<ScanComparisonResponse> {
  return apiRequest(`/organizations/${organizationId}/scans/${scanId}/comparison`, token);
}

export function triggerScan(organizationId: string, token: string, body?: TriggerScanRequest): Promise<ScanResponse> {
  return apiRequest(`/organizations/${organizationId}/scans`, token, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function getScanSchedule(organizationId: string, token: string): Promise<ScanScheduleResponse | null> {
  return apiRequest(`/organizations/${organizationId}/scan-schedule`, token);
}

export function createScanSchedule(
  organizationId: string,
  token: string,
  body: CreateScanScheduleRequest,
): Promise<ScanScheduleResponse> {
  return apiRequest(`/organizations/${organizationId}/scan-schedule`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateScanSchedule(
  organizationId: string,
  token: string,
  body: UpdateScanScheduleRequest,
): Promise<ScanScheduleResponse> {
  return apiRequest(`/organizations/${organizationId}/scan-schedule`, token, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteScanSchedule(organizationId: string, token: string): Promise<void> {
  return apiRequest(`/organizations/${organizationId}/scan-schedule`, token, { method: 'DELETE' });
}

export function getGovernanceIssues(
  organizationId: string,
  token: string,
  query: GovernanceIssueListQuery = {},
): Promise<PaginatedResponse<GovernanceIssueResponse>> {
  const queryString = buildQueryString(query);
  return apiRequest(`/organizations/${organizationId}/governance/issues${queryString}`, token);
}

export function getGovernanceIssue(organizationId: string, issueId: string, token: string): Promise<GovernanceIssueResponse> {
  return apiRequest(`/organizations/${organizationId}/governance/issues/${issueId}`, token);
}

export function createGovernanceIssue(
  organizationId: string,
  token: string,
  body: CreateGovernanceIssueRequest,
): Promise<GovernanceIssueResponse> {
  return apiRequest(`/organizations/${organizationId}/governance/issues`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateGovernanceIssue(
  organizationId: string,
  issueId: string,
  token: string,
  body: UpdateGovernanceIssueRequest,
): Promise<GovernanceIssueResponse> {
  return apiRequest(`/organizations/${organizationId}/governance/issues/${issueId}`, token, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function getGovernanceSummary(organizationId: string, token: string): Promise<GovernanceSummaryResponse> {
  return apiRequest(`/organizations/${organizationId}/governance/summary`, token);
}

export function getAssignableUsers(organizationId: string, token: string): Promise<AssignableUserResponse[]> {
  return apiRequest(`/organizations/${organizationId}/governance/users`, token);
}

export function getDocumentOwners(organizationId: string, documentId: string, token: string): Promise<DocumentOwnerResponse[]> {
  return apiRequest(`/organizations/${organizationId}/documents/${documentId}/owners`, token);
}

export function assignDocumentOwner(
  organizationId: string,
  documentId: string,
  token: string,
  body: AssignDocumentOwnerRequest,
): Promise<DocumentOwnerResponse> {
  return apiRequest(`/organizations/${organizationId}/documents/${documentId}/owners`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function removeDocumentOwner(organizationId: string, documentId: string, ownerId: string, token: string): Promise<void> {
  return apiRequest(`/organizations/${organizationId}/documents/${documentId}/owners/${ownerId}`, token, {
    method: 'DELETE',
  });
}

export function getIssueActivity(
  organizationId: string,
  issueId: string,
  token: string,
  query: GovernanceActivityListQuery = {},
): Promise<PaginatedResponse<GovernanceActivityResponse>> {
  const queryString = buildQueryString(query);
  return apiRequest(`/organizations/${organizationId}/governance/issues/${issueId}/activity${queryString}`, token);
}

export function getOrganizationActivity(
  organizationId: string,
  token: string,
  query: GovernanceActivityListQuery = {},
): Promise<PaginatedResponse<GovernanceActivityResponse>> {
  const queryString = buildQueryString(query);
  return apiRequest(`/organizations/${organizationId}/governance/activity${queryString}`, token);
}

export function getGovernanceAnalytics(
  organizationId: string,
  token: string,
  query: GovernanceAnalyticsQuery = {},
): Promise<GovernanceAnalyticsResponse> {
  const queryString = buildQueryString(query);
  return apiRequest(`/organizations/${organizationId}/governance/analytics${queryString}`, token);
}
