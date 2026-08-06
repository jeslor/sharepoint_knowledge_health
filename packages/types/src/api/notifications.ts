import type { SortDirection } from './documents';

/**
 * ADR-0021: a per-user, in-app notification inbox — deliberately not a
 * duplicate of GovernanceActivity (governance.ts). GovernanceActivity is a
 * shared, organization-wide audit feed; Notification is filtered to one
 * userId. The same "two entities answering two different questions" split
 * ADR-0016 §4.1 already established for HealthIssue vs. GovernanceIssue.
 *
 * A closed, deliberately narrow V1 trigger set (ADR-0021 §3.2) — not
 * every GovernanceActivityType notifies (e.g. no StatusChanged/
 * ResolutionNoteUpdated, which would be pure noise). ResolutionSuggested
 * has no synchronous GovernanceActivity counterpart — it's written by the
 * asynchronous reconciliation job, not a human/API action.
 */
export type NotificationTypeValue = 'IssueAssigned' | 'OwnerAssigned' | 'IssueReopened' | 'ResolutionSuggested' | 'DocumentRemoved';

export interface NotificationResponse {
  id: string;
  type: NotificationTypeValue;
  message: string;
  governanceIssueId: string | null;
  documentId: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationListQuery {
  page?: number;
  pageSize?: number;
  read?: boolean;
  sortDir?: SortDirection;
}

export interface UnreadNotificationCountResponse {
  count: number;
}
