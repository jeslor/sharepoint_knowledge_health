// See documents.ts header — same rationale (ADR-0009 shared API DTOs).

import type { GovernanceIssueTypeValue } from './governance';

// ADR-0022 §6/§8, Phase 6: issueType reuses GovernanceIssueTypeValue exactly
// (itself already redeclared from packages/database's HealthIssueCriterion,
// see governance.ts's own comment) — no third, parallel taxonomy invented
// for this request.
export interface CreateRemediationJobRequest {
  issueType: GovernanceIssueTypeValue;
  documentIds: string[];
  nextReviewDueAt: string;
}

export interface CreateRemediationJobResponse {
  remediationJobId: string;
  // The number of RemediationItem rows actually created (i.e. the eligible
  // subset of documentIds) — matches RemediationJob.totalCount exactly.
  totalCount: number;
  // ADR-0022 §8: every client-supplied documentId that failed server-side
  // eligibility re-validation — never silently dropped.
  ineligibleDocumentIds: string[];
}

// Matches packages/database's RemediationJobStatus/RemediationItemStatus
// exactly (P0-2's locked Option A: no Failed job status) — redeclared here
// rather than imported, same as GovernanceIssueTypeValue above.
export type RemediationJobStatusValue = 'Running' | 'Completed';
export type RemediationItemStatusValue = 'Pending' | 'Succeeded' | 'Failed' | 'Skipped';

// P0-3 (Phase 6): the history-list/progress-detail shape shared by both new
// GET endpoints. succeededCount/failedCount/skippedCount are always derived
// live from RemediationItem rows (RemediationItemRepository.groupByStatusForJobs
// for the list, the already-loaded item set for the detail view) — never
// read from RemediationJob.succeededCount/failedCount directly, since those
// columns are only written once, at completion, and would read as stale
// zeros for a still-Running job.
export interface RemediationJobSummary {
  id: string;
  status: RemediationJobStatusValue;
  issueType: GovernanceIssueTypeValue;
  // Same field name as CreateRemediationJobRequest/SetDocumentReviewDateRequest
  // — the value the job was created with, read back out of RemediationJob.payload.
  nextReviewDueAt: string | null;
  initiatedByUserId: string;
  // Unlike AuditLogResponse's actorUserId, this is never null (RemediationJob.
  // initiatedByUserId is a required, onDelete: Restrict column — the actor
  // always exists), so unlike actorUserName this is never null either.
  initiatedByUserName: string;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface RemediationJobListQuery {
  page?: number;
  pageSize?: number;
}

export interface RemediationItemResult {
  documentId: string;
  // ADR-0022 write-back MVP: the document's display name, resolved at read
  // time from the tenant-scoped Document row, so the progress/detail UI can
  // show a human-readable label instead of an opaque id. null only when the
  // document no longer resolves (e.g. deleted after the job ran).
  documentName: string | null;
  status: RemediationItemStatusValue;
  errorType: string | null;
  errorMessage: string | null;
  attemptCount: number;
}

export interface RemediationJobDetailResponse extends RemediationJobSummary {
  items: RemediationItemResult[];
}
