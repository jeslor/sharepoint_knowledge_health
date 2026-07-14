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
  // Phase 8D — additive, backward compatible.
  totalCount: number;
  // Mean(resolvedAt - createdAt) across currently Resolved issues, in
  // hours. null when there are none yet. See ADR-0016 implementation
  // notes for why this reflects only the latest resolution cycle.
  averageResolutionTimeHours: number | null;
  createdThisMonth: number;
  resolvedThisMonth: number;
  // Rounded percentage: resolvedCount / totalCount * 100, 0 when totalCount is 0.
  completionRate: number;
}

// Minimal shape for the assignment dropdown — not a general "list users"
// endpoint, scoped specifically to who a GovernanceIssue can be assigned
// to (Active users in this organization).
export interface AssignableUserResponse {
  id: string;
  displayName: string;
  email: string;
}

// Phase 8C — immutable, append-only activity record (ADR-0016 implementation
// notes). Matches packages/database's GovernanceActivityType, redeclared
// here per this file's own established convention (GovernanceIssueTypeValue
// above does the same for HealthIssueCriterion).
export type GovernanceActivityTypeValue =
  | 'IssueCreated'
  | 'IssueAssigned'
  | 'AssigneeChanged'
  | 'StatusChanged'
  | 'ResolutionNoteUpdated'
  | 'OwnerAssigned'
  | 'OwnerRemoved'
  | 'IssueReopened'
  | 'IssueResolved';

export interface GovernanceActivityResponse {
  id: string;
  governanceIssueId: string | null;
  documentId: string;
  documentName: string;
  actorUserId: string;
  actorUserName: string;
  activityType: GovernanceActivityTypeValue;
  // Deliberately plain display-ready strings (e.g. an assignee's name, not
  // their id) — resolved once at write time so no reader ever needs a
  // second lookup just to render human-readable text.
  previousValue: string | null;
  newValue: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface GovernanceActivityListQuery {
  page?: number;
  pageSize?: number;
  activityType?: GovernanceActivityTypeValue;
  sortDir?: SortDirection;
  since?: string;
  until?: string;
}

// Phase 8D — dashboard-chart-shaped analytics, distinct from the
// list/pagination-shaped endpoints above. See ADR-0016 implementation
// notes for why issueTrends/recentActivityByType are sourced from
// GovernanceActivity (an append-only event log, correct across
// reopen/resolve cycles) while the other four views are sourced from
// GovernanceIssue's current-state fields (a point-in-time snapshot).
export interface GovernanceAnalyticsQuery {
  since?: string;
  until?: string;
  status?: GovernanceIssueStatusValue;
  severity?: IssueSeverityFilter;
  issueType?: GovernanceIssueTypeValue;
  assignedUserId?: string;
}

export interface IssueTrendPoint {
  date: string;
  opened: number;
  resolved: number;
}

export interface AnalyticsBucket {
  label: string;
  count: number;
}

export interface GovernanceAnalyticsResponse {
  since: string;
  until: string;
  issueTrends: IssueTrendPoint[];
  issuesByType: AnalyticsBucket[];
  statusDistribution: AnalyticsBucket[];
  resolutionTimeDistribution: AnalyticsBucket[];
  issueAging: AnalyticsBucket[];
  recentActivityByType: AnalyticsBucket[];
}
