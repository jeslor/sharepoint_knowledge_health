import type { GovernanceActivityResponse } from '@sph/types';
import { formatGovernanceActivity, formatRelativeDay } from '../format-governance-activity';

function activity(overrides: Partial<GovernanceActivityResponse> = {}): GovernanceActivityResponse {
  return {
    id: 'activity-1',
    governanceIssueId: 'issue-1',
    documentId: 'doc-1',
    documentName: 'Handbook.docx',
    actorUserId: 'user-1',
    actorUserName: 'Sarah',
    activityType: 'IssueCreated',
    previousValue: null,
    newValue: null,
    metadata: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('formatGovernanceActivity', () => {
  it('formats IssueCreated without exposing the raw enum value', () => {
    expect(formatGovernanceActivity(activity({ activityType: 'IssueCreated' }))).toBe('created this issue');
  });

  it('formats IssueAssigned using the assignee\'s display name', () => {
    expect(formatGovernanceActivity(activity({ activityType: 'IssueAssigned', newValue: 'John' }))).toBe(
      'assigned issue to John',
    );
  });

  it('formats AssigneeChanged as a reassignment when there is a new assignee', () => {
    expect(
      formatGovernanceActivity(activity({ activityType: 'AssigneeChanged', previousValue: 'Sarah', newValue: 'John' })),
    ).toBe('reassigned from Sarah to John');
  });

  it('formats AssigneeChanged as an unassignment when newValue is null', () => {
    expect(
      formatGovernanceActivity(activity({ activityType: 'AssigneeChanged', previousValue: 'Sarah', newValue: null })),
    ).toBe('unassigned Sarah');
  });

  it('formats StatusChanged with friendly status labels, not raw enum values', () => {
    expect(
      formatGovernanceActivity(activity({ activityType: 'StatusChanged', previousValue: 'Open', newValue: 'InProgress' })),
    ).toBe('changed status from Open to In Progress');
  });

  it('formats IssueResolved and IssueReopened', () => {
    expect(formatGovernanceActivity(activity({ activityType: 'IssueResolved' }))).toBe('resolved this issue');
    expect(formatGovernanceActivity(activity({ activityType: 'IssueReopened' }))).toBe('reopened this issue');
  });

  it('formats ResolutionNoteUpdated without exposing the note content', () => {
    expect(
      formatGovernanceActivity(activity({ activityType: 'ResolutionNoteUpdated', newValue: 'Fixed via reassignment' })),
    ).toBe('updated the resolution notes');
  });

  it('formats OwnerAssigned and OwnerRemoved', () => {
    expect(formatGovernanceActivity(activity({ activityType: 'OwnerAssigned', newValue: 'Sarah' }))).toBe(
      'assigned Sarah as document owner',
    );
    expect(formatGovernanceActivity(activity({ activityType: 'OwnerRemoved', previousValue: 'Sarah' }))).toBe(
      'removed Sarah as document owner',
    );
  });
});

describe('formatRelativeDay', () => {
  it('labels today\'s date as "Today"', () => {
    expect(formatRelativeDay(new Date().toISOString())).toBe('Today');
  });

  it('labels yesterday\'s date as "Yesterday"', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatRelativeDay(yesterday.toISOString())).toBe('Yesterday');
  });

  it('labels 3 days ago as "3 days ago"', () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    expect(formatRelativeDay(threeDaysAgo.toISOString())).toBe('3 days ago');
  });
});
