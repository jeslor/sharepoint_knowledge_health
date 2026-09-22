import type {
  AssignableUserResponse,
  AssignDocumentOwnerRequest,
  AuditLogListQuery,
  AuditLogResponse,
  ConsentCallbackRequest,
  ConsentResolution,
  CreateGovernanceIssueRequest,
  CreateRemediationJobRequest,
  CreateRemediationJobResponse,
  CreateScanScheduleRequest,
  DocumentDetailResponse,
  DocumentHealthQuery,
  DocumentHealthResponse,
  DocumentOwnerResponse,
  DocumentResponse,
  DocumentReviewResponse,
  DocumentScoreHistoryResponse,
  GovernanceActivityListQuery,
  GovernanceActivityResponse,
  GovernanceAnalyticsQuery,
  GovernanceAnalyticsResponse,
  GovernanceIssueListQuery,
  GovernanceIssueResponse,
  GovernanceIssueTypeCountsResponse,
  GovernanceSummaryResponse,
  HealthSummaryResponse,
  HealthTrendResponse,
  MeResponse,
  MicrosoftTenantResponse,
  NotificationListQuery,
  NotificationResponse,
  OnboardingStatusResponse,
  OrganizationUserResponse,
  OwnershipCoverageResponse,
  PaginatedResponse,
  ConfirmReviewDateMappingRequest,
  RemediationJobDetailResponse,
  RemediationJobListQuery,
  RemediationJobSummary,
  ReviewDateEligibilityResponse,
  ReviewDateLibraryResponse,
  ReviewDateMappingResponse,
  ClassificationCandidateColumn,
  ClassificationFieldResponse,
  ClassificationLibraryResponse,
  DesignateClassificationFieldRequest,
  ScanComparisonResponse,
  ScanResponse,
  ScanScheduleResponse,
  SetDocumentReviewDateRequest,
  SharePointSiteResponse,
  TriggerScanRequest,
  RequestUpgradeRequest,
  RequestUpgradeResponse,
  UnreadNotificationCountResponse,
  UpdateGovernanceIssueRequest,
  UpdateScanScheduleRequest,
  UsageResponse,
} from '@sph/types';
import { apiRequest } from './client';

export function getMe(token: string): Promise<MeResponse> {
  return apiRequest('/auth/me', token);
}

// POST /auth/consent-callback is not behind TenantContextGuard (no org
// exists yet to scope it to) — it reads idToken from the body, never the
// Authorization header, so passing the same idToken as the bearer token
// here is harmless, just unused server-side.
export function postConsentCallback(idToken: string, tenantName: string): Promise<ConsentResolution> {
  const body: ConsentCallbackRequest = { idToken, tenantName };
  return apiRequest('/auth/consent-callback', idToken, { method: 'POST', body: JSON.stringify(body) });
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

// Phase 9.5: the full site-management view (status/approval/timestamps) —
// same GET as getSharePointSites above, just the complete response shape
// instead of the narrow filter-option projection.
export function listSharePointSites(organizationId: string, token: string): Promise<SharePointSiteResponse[]> {
  return apiRequest(`/organizations/${organizationId}/sharepoint-sites`, token);
}

// ADR-0014 amendment: enqueues onto DISCOVERY_QUEUE — apps/worker executes
// discovery asynchronously. Returns the MicrosoftTenant reflecting the new
// discoveryStatus (Queued, or unchanged if a discovery was already
// in flight), never sites, which do not exist synchronously at request
// time. Callers must read GET /organizations/:id/onboarding-status (or
// re-list sites later) to observe the result — this call does not.
export function discoverSharePointSites(organizationId: string, token: string): Promise<MicrosoftTenantResponse> {
  return apiRequest(`/organizations/${organizationId}/discover-sites`, token, { method: 'POST' });
}

// ADR-0017: purely derived — see OnboardingStatusResponse's own doc
// comment. Safe to poll; every field is a cheap read, never a stored
// progress flag on either side of the wire.
export function getOnboardingStatus(organizationId: string, token: string): Promise<OnboardingStatusResponse> {
  return apiRequest(`/organizations/${organizationId}/onboarding-status`, token);
}

export function approveSharePointSite(organizationId: string, siteId: string, token: string): Promise<SharePointSiteResponse> {
  return apiRequest(`/organizations/${organizationId}/sharepoint-sites/${siteId}/approve`, token, { method: 'PATCH' });
}

export function revokeSharePointSite(organizationId: string, siteId: string, token: string): Promise<SharePointSiteResponse> {
  return apiRequest(`/organizations/${organizationId}/sharepoint-sites/${siteId}/revoke`, token, { method: 'PATCH' });
}

// Phase 2: enumerates a site's document libraries with whatever mapping
// state already exists — the prerequisite the Review Date settings page
// needs that nothing else exposes (eligibility/confirm both require a
// graphListId as input, neither can discover one).
export function listReviewDateLibraries(
  organizationId: string,
  siteId: string,
  token: string,
): Promise<ReviewDateLibraryResponse[]> {
  return apiRequest(`/organizations/${organizationId}/sharepoint-sites/${siteId}/review-date-libraries`, token);
}

// Read-only — lazy, on-demand per library, never prefetched for an entire
// site's libraries at once (see the backend's own doc comment on
// listReviewDateLibraries for why).
export function checkReviewDateEligibility(
  organizationId: string,
  siteId: string,
  graphListId: string,
  token: string,
): Promise<ReviewDateEligibilityResponse> {
  const queryString = buildQueryString({ graphListId });
  return apiRequest(`/organizations/${organizationId}/sharepoint-sites/${siteId}/review-date-mapping/eligibility${queryString}`, token);
}

export function confirmReviewDateMapping(
  organizationId: string,
  siteId: string,
  body: ConfirmReviewDateMappingRequest,
  token: string,
): Promise<ReviewDateMappingResponse> {
  return apiRequest(`/organizations/${organizationId}/sharepoint-sites/${siteId}/review-date-mapping/confirm`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ADR-0025: Taxonomy classification-field configuration.
export function listClassificationLibraries(
  organizationId: string,
  siteId: string,
  token: string,
): Promise<ClassificationLibraryResponse[]> {
  return apiRequest(`/organizations/${organizationId}/sharepoint-sites/${siteId}/classification-libraries`, token);
}

export function listClassificationCandidates(
  organizationId: string,
  siteId: string,
  graphListId: string,
  token: string,
): Promise<ClassificationCandidateColumn[]> {
  const queryString = buildQueryString({ graphListId });
  return apiRequest(`/organizations/${organizationId}/sharepoint-sites/${siteId}/classification-candidates${queryString}`, token);
}

export function designateClassificationField(
  organizationId: string,
  siteId: string,
  body: DesignateClassificationFieldRequest,
  token: string,
): Promise<ClassificationFieldResponse> {
  return apiRequest(`/organizations/${organizationId}/sharepoint-sites/${siteId}/classification-fields`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function removeClassificationField(
  organizationId: string,
  siteId: string,
  fieldId: string,
  token: string,
): Promise<void> {
  return apiRequest(`/organizations/${organizationId}/sharepoint-sites/${siteId}/classification-fields/${fieldId}`, token, {
    method: 'DELETE',
  });
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

// Phase 1 work-queue summary strip — accepts the same query shape as
// getGovernanceIssues so the counts and the list can be driven by the
// identical filter state.
export function getGovernanceIssueTypeCounts(
  organizationId: string,
  token: string,
  query: GovernanceIssueListQuery = {},
): Promise<GovernanceIssueTypeCountsResponse> {
  const queryString = buildQueryString(query);
  return apiRequest(`/organizations/${organizationId}/governance/issues/type-counts${queryString}`, token);
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

export function setDocumentReviewDate(
  organizationId: string,
  documentId: string,
  token: string,
  body: SetDocumentReviewDateRequest,
): Promise<DocumentReviewResponse> {
  return apiRequest(`/organizations/${organizationId}/documents/${documentId}/review`, token, {
    method: 'PATCH',
    body: JSON.stringify(body),
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

export function listOrganizationUsers(organizationId: string, token: string): Promise<OrganizationUserResponse[]> {
  return apiRequest(`/organizations/${organizationId}/users`, token);
}

export function approveOrganizationUser(organizationId: string, userId: string, token: string): Promise<OrganizationUserResponse> {
  return apiRequest(`/organizations/${organizationId}/users/${userId}/approve`, token, { method: 'PATCH' });
}

export function rejectOrganizationUser(organizationId: string, userId: string, token: string): Promise<OrganizationUserResponse> {
  return apiRequest(`/organizations/${organizationId}/users/${userId}/reject`, token, { method: 'PATCH' });
}

export function getGovernanceAnalytics(
  organizationId: string,
  token: string,
  query: GovernanceAnalyticsQuery = {},
): Promise<GovernanceAnalyticsResponse> {
  const queryString = buildQueryString(query);
  return apiRequest(`/organizations/${organizationId}/governance/analytics${queryString}`, token);
}

export function getAuditLog(
  organizationId: string,
  token: string,
  query: AuditLogListQuery = {},
): Promise<PaginatedResponse<AuditLogResponse>> {
  const queryString = buildQueryString(query);
  return apiRequest(`/organizations/${organizationId}/audit-log${queryString}`, token);
}

export function getNotifications(
  organizationId: string,
  token: string,
  query: NotificationListQuery = {},
): Promise<PaginatedResponse<NotificationResponse>> {
  const queryString = buildQueryString(query);
  return apiRequest(`/organizations/${organizationId}/notifications${queryString}`, token);
}

export function getUnreadNotificationCount(organizationId: string, token: string): Promise<UnreadNotificationCountResponse> {
  return apiRequest(`/organizations/${organizationId}/notifications/unread-count`, token);
}

export function markNotificationRead(organizationId: string, notificationId: string, token: string): Promise<NotificationResponse> {
  return apiRequest(`/organizations/${organizationId}/notifications/${notificationId}`, token, { method: 'PATCH' });
}

export function markAllNotificationsRead(organizationId: string, token: string): Promise<{ updatedCount: number }> {
  return apiRequest(`/organizations/${organizationId}/notifications/mark-all-read`, token, { method: 'POST' });
}

// P0-6 (ADR-0022 Phase 7): the exact CreateRemediationJobRequest/Response
// contract apps/api/src/remediation/remediation.controller.ts already
// implements (P0-1) — issueType/documentIds/nextReviewDueAt in, {
// remediationJobId, totalCount, ineligibleDocumentIds } out.
export function createRemediationJob(
  organizationId: string,
  token: string,
  body: CreateRemediationJobRequest,
): Promise<CreateRemediationJobResponse> {
  return apiRequest(`/organizations/${organizationId}/remediation-jobs`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// P0-7 (ADR-0022 Phase 7): the exact PaginatedResponse<RemediationJobSummary>
// contract apps/api/src/remediation/remediation.controller.ts's
// listRemediationJobs already implements (P0-3) — same page/pageSize
// convention as getAuditLog/getNotifications above, via buildQueryString.
export function listRemediationJobs(
  organizationId: string,
  token: string,
  query: RemediationJobListQuery = {},
): Promise<PaginatedResponse<RemediationJobSummary>> {
  const queryString = buildQueryString(query);
  return apiRequest(`/organizations/${organizationId}/remediation-jobs${queryString}`, token);
}

// P0-7: the exact RemediationJobDetailResponse contract
// getRemediationJob already implements (P0-3) — job summary plus
// per-RemediationItem results.
export function getRemediationJob(
  organizationId: string,
  jobId: string,
  token: string,
): Promise<RemediationJobDetailResponse> {
  return apiRequest(`/organizations/${organizationId}/remediation-jobs/${jobId}`, token);
}

// ADR-0024 Phase A: the exact OwnershipCoverageResponse contract
// apps/api/src/ownership/ownership.controller.ts implements — no query
// parameters (a current-state snapshot, not a filtered/date-ranged view).
export function getOwnershipCoverage(organizationId: string, token: string): Promise<OwnershipCoverageResponse> {
  return apiRequest(`/organizations/${organizationId}/ownership-coverage`, token);
}

// Phase 5: the exact UsageResponse contract apps/api/src/usage/usage.controller.ts
// implements (Phase 4) — a cheap, tenant-scoped entitlement-counter read,
// no query parameters.
export function getUsage(organizationId: string, token: string): Promise<UsageResponse> {
  return apiRequest(`/organizations/${organizationId}/usage`, token);
}

// Phase 6: the exact RequestUpgradeResponse contract
// apps/api/src/upgrade-request/upgrade-request.controller.ts implements —
// body carries only the optional message; organization/user/usage context
// is derived server-side, never sent from here.
export function requestUpgrade(
  organizationId: string,
  token: string,
  body: RequestUpgradeRequest,
): Promise<RequestUpgradeResponse> {
  return apiRequest(`/organizations/${organizationId}/upgrade-request`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
