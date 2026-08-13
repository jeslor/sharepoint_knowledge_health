import { render, screen } from '@testing-library/react';
import type { GovernanceIssueResponse } from '@sph/types';
import { GovernanceIssueList } from '../governance-issue-list';

function issue(overrides: Partial<GovernanceIssueResponse> = {}): GovernanceIssueResponse {
  return {
    id: 'issue-1',
    documentId: 'doc-1',
    documentName: 'Handbook.docx',
    siteName: 'Team Site',
    issueType: 'Freshness',
    severity: 'RequiresReview',
    status: 'Open',
    assignedUserId: null,
    assignedUserName: null,
    resolutionNotes: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    resolvedAt: null,
    stillDetected: true,
    message: null,
    documentWebUrl: null,
    ...overrides,
  };
}

describe('GovernanceIssueList', () => {
  it('renders the empty state when there are no issues', () => {
    render(<GovernanceIssueList issues={[]} />);
    expect(screen.getByText('No governance issues match the current filters.')).toBeInTheDocument();
  });

  it('renders document, site, type, severity, status, assignment, and stillDetected for each issue', () => {
    render(<GovernanceIssueList issues={[issue({ assignedUserName: 'Sarah' })]} />);

    expect(screen.getByText('Handbook.docx')).toBeInTheDocument();
    expect(screen.getByText('Team Site')).toBeInTheDocument();
    expect(screen.getByText('Freshness')).toBeInTheDocument();
    expect(screen.getByText('Sarah')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
  });

  it('shows "Unassigned" when no user is assigned', () => {
    render(<GovernanceIssueList issues={[issue({ assignedUserName: null })]} />);
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('links each row to its issue detail page', () => {
    render(<GovernanceIssueList issues={[issue({ id: 'issue-42' })]} />);
    expect(screen.getByRole('link', { name: 'Handbook.docx' })).toHaveAttribute(
      'href',
      '/dashboard/governance/issues/issue-42',
    );
  });

  it('renders the human-readable issue type label, not the raw enum (e.g. "Review Status", not "ReviewStatus")', () => {
    render(<GovernanceIssueList issues={[issue({ issueType: 'ReviewStatus' })]} />);

    expect(screen.getByText('Review Status')).toBeInTheDocument();
    expect(screen.queryByText('ReviewStatus')).not.toBeInTheDocument();
  });

  it('falls back to the raw value if an unknown issueType somehow reaches the UI', () => {
    render(<GovernanceIssueList issues={[issue({ issueType: 'SomethingNew' as GovernanceIssueResponse['issueType'] })]} />);
    expect(screen.getByText('SomethingNew')).toBeInTheDocument();
  });
});
