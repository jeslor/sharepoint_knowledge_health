// See documents.ts header — same rationale (ADR-0009 shared API DTOs).
// ADR-0016 §4.1: GovernanceIssue is user workflow state, kept entirely
// separate from HealthIssue (calculated, immutable, scan-owned evidence).

import type { IssueSeverityFilter, SortDirection } from './documents';

export type GovernanceIssueStatusValue = 'Open' | 'InProgress' | 'Resolved';

// Matches packages/database's HealthIssueCriterion — redeclared here rather
// than imported, same rationale as IssueSeverityFilter in documents.ts.
export type GovernanceIssueTypeValue = 'Freshness' | 'Ownership' | 'ReviewStatus' | 'Metadata' | 'Duplication' | 'Age';

export interface GovernanceIssueResponse {
  id: string;
  documentId: string;
  documentName: string;
  siteName: string;
  issueType: GovernanceIssueTypeValue;
  severity: IssueSeverityFilter;
  status: GovernanceIssueStatusValue;
  assignedUserId: string | null;
  assignedUserName: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  // ADR-0016 §4.1/§5: derived at read time from the document's current
  // HealthIssues — never stored on GovernanceIssue itself.
  stillDetected: boolean;
}

export interface GovernanceIssueListQuery {
  page?: number;
  pageSize?: number;
  status?: GovernanceIssueStatusValue;
  severity?: IssueSeverityFilter;
  assignedUserId?: string;
  issueType?: GovernanceIssueTypeValue;
  documentId?: string;
  sortBy?: 'createdAt' | 'updatedAt';
  sortDir?: SortDirection;
}

export interface CreateGovernanceIssueRequest {
  documentId: string;
  issueType: GovernanceIssueTypeValue;
}

export interface UpdateGovernanceIssueRequest {
  status?: GovernanceIssueStatusValue;
  assignedUserId?: string | null;
  resolutionNotes?: string | null;
}

export interface GovernanceSummaryResponse {
  openCount: number;
  inProgressCount: number;
  resolvedCount: number;
  criticalCount: number;
  assignedCount: number;
  byType: Record<string, number>;
}

// Minimal shape for the assignment dropdown — not a general "list users"
// endpoint, scoped specifically to who a GovernanceIssue can be assigned
// to (Active users in this organization).
export interface AssignableUserResponse {
  id: string;
  displayName: string;
  email: string;
}
