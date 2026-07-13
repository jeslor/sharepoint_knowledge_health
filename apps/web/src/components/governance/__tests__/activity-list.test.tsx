import { render, screen } from '@testing-library/react';
import type { GovernanceActivityResponse } from '@sph/types';
import { ActivityList } from '../activity-list';

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
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ActivityList', () => {
  it('renders an empty state when there is no activity', () => {
    render(<ActivityList activities={[]} />);
    expect(screen.getByText('No activity yet.')).toBeInTheDocument();
  });

  it('renders the actor name and a formatted, enum-free description', () => {
    render(<ActivityList activities={[activity({ actorUserName: 'Sarah', activityType: 'IssueCreated' })]} />);

    expect(screen.getByText('Sarah')).toBeInTheDocument();
    expect(screen.getByText(/created this issue/)).toBeInTheDocument();
    expect(screen.queryByText('IssueCreated')).not.toBeInTheDocument();
  });

  it('groups activities under a "Today" heading when they happened today', () => {
    render(<ActivityList activities={[activity()]} />);
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('does not show a link to the related issue by default', () => {
    render(<ActivityList activities={[activity()]} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows a link to the related issue when showIssueLink is set (org-wide feed)', () => {
    render(<ActivityList activities={[activity({ governanceIssueId: 'issue-42', documentName: 'Handbook.docx' })]} showIssueLink />);

    const link = screen.getByRole('link', { name: 'Handbook.docx' });
    expect(link).toHaveAttribute('href', '/dashboard/governance/issues/issue-42');
  });
});
