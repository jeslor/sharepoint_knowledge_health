import type { GovernanceIssueTypeValue } from '@sph/types';

export type GovernanceIssuePlanStatus = 'Open' | 'InProgress' | 'Resolved';
export type GovernanceAssignee = 'none' | 'admin' | 'assignee';

export interface GovernanceIssuePlan {
  /** Which seeded document (document-plan.ts `seq`) this issue is opened against. */
  docSeq: number;
  issueType: GovernanceIssueTypeValue;
  // No `severity` field, deliberately — createIssue() always snapshots
  // severity from the matching HealthIssue's own computed value, never a
  // caller-supplied one (governance-issues.service.ts). Hardcoding an
  // expected severity here would risk silently diverging from whatever
  // the real scoring algorithm actually produced for that document.
  status: GovernanceIssuePlanStatus;
  assignedTo: GovernanceAssignee;
  /** Days before "now" IssueCreated happened. Ignored for the one 'live' entry. */
  createdDaysAgo: number;
  /** Only meaningful when status is InProgress or Resolved. */
  inProgressDaysAgo?: number;
  /** Only meaningful when status is Resolved. */
  resolvedDaysAgo?: number;
  /**
   * True for exactly one issue — created through the real, live
   * GovernanceIssuesService/GovernanceActivityService call path (today,
   * "now"), not backdated — so it produces a genuine, current-moment
   * GovernanceActivity + Notification the same way a human action would
   * during the actual demo. Every other entry is backdated (see
   * seed.ts's createHistoricalIssue) because GovernanceActivity is
   * immutable by design (ADR-0016) — no service call, live or otherwise,
   * can backdate it after the fact; backdating is only possible at the
   * moment of creation, which is what createHistoricalIssue does directly
   * through the tenant-scoped repository layer instead of the service.
   */
  live?: boolean;
  /**
   * True for exactly one Open/InProgress issue — after seeding, a second,
   * newer HealthScore is created for its document where this criterion no
   * longer applies, then the reconciliation-equivalent logic runs,
   * producing a real ResolutionSuggested notification through the exact
   * mechanism NotificationReconciliationService uses (upsertByDedupeKey).
   */
  simulateResolutionSuggested?: boolean;
}

// 11 issues: 3 Open, 4 InProgress, 4 Resolved — a realistic, not
// artificially-uniform, backlog distribution. docSeq references
// document-plan.ts.
export const GOVERNANCE_ISSUE_PLAN: GovernanceIssuePlan[] = [
  { docSeq: 7, issueType: 'Ownership', status: 'Open', assignedTo: 'none', createdDaysAgo: 25 },
  { docSeq: 8, issueType: 'Ownership', status: 'InProgress', assignedTo: 'assignee', createdDaysAgo: 20, inProgressDaysAgo: 15 },
  { docSeq: 11, issueType: 'ReviewStatus', status: 'Resolved', assignedTo: 'admin', createdDaysAgo: 18, inProgressDaysAgo: 12, resolvedDaysAgo: 5 },
  { docSeq: 12, issueType: 'ReviewStatus', status: 'Open', assignedTo: 'admin', createdDaysAgo: 9, simulateResolutionSuggested: true },
  { docSeq: 15, issueType: 'Freshness', status: 'InProgress', assignedTo: 'assignee', createdDaysAgo: 22, inProgressDaysAgo: 10 },
  { docSeq: 16, issueType: 'Freshness', status: 'Resolved', assignedTo: 'assignee', createdDaysAgo: 28, inProgressDaysAgo: 20, resolvedDaysAgo: 8 },
  { docSeq: 19, issueType: 'Age', status: 'Open', assignedTo: 'assignee', createdDaysAgo: 14 },
  { docSeq: 23, issueType: 'Duplication', status: 'Resolved', assignedTo: 'admin', createdDaysAgo: 10, inProgressDaysAgo: 6, resolvedDaysAgo: 2 },
  { docSeq: 26, issueType: 'Metadata', status: 'Open', assignedTo: 'none', createdDaysAgo: 6 },
  { docSeq: 29, issueType: 'Ownership', status: 'Open', assignedTo: 'admin', createdDaysAgo: 0, live: true },
  { docSeq: 30, issueType: 'Age', status: 'InProgress', assignedTo: 'assignee', createdDaysAgo: 16, inProgressDaysAgo: 9 },
];
