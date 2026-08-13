import { render, screen, fireEvent } from '@testing-library/react';
import GovernanceDashboardPage from '../page';

const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();

const mockUseGovernanceIssues = jest.fn();
const mockUseGovernanceIssueTypeCounts = jest.fn();
const mockUseGovernanceSummary = jest.fn();
const mockUseAssignableUsers = jest.fn();
const mockUseOrganizationActivity = jest.fn();
const mockUseCurrentUser = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock('@/lib/api/hooks/use-governance-issues', () => ({
  useGovernanceIssues: (query: unknown) => mockUseGovernanceIssues(query),
}));
jest.mock('@/lib/api/hooks/use-governance-issue-type-counts', () => ({
  useGovernanceIssueTypeCounts: (query: unknown) => mockUseGovernanceIssueTypeCounts(query),
}));
jest.mock('@/lib/api/hooks/use-governance-summary', () => ({
  useGovernanceSummary: () => mockUseGovernanceSummary(),
}));
jest.mock('@/lib/api/hooks/use-assignable-users', () => ({
  useAssignableUsers: () => mockUseAssignableUsers(),
}));
jest.mock('@/lib/api/hooks/use-organization-activity', () => ({
  useOrganizationActivity: () => mockUseOrganizationActivity(),
}));
jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

describe('GovernanceDashboardPage — Phase 1 work queue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockUseCurrentUser.mockReturnValue({ user: { id: 'user-1', role: 'Member', organizationId: 'org-1' } });
    mockUseGovernanceIssues.mockReturnValue({ data: { data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } }, loading: false, error: undefined });
    mockUseGovernanceIssueTypeCounts.mockReturnValue({ data: { byType: {} }, loading: false, error: undefined });
    mockUseGovernanceSummary.mockReturnValue({ data: undefined, loading: false, error: undefined });
    mockUseAssignableUsers.mockReturnValue({ data: [] });
    mockUseOrganizationActivity.mockReturnValue({ data: undefined, loading: false, error: undefined });
  });

  it('defaults to "My Issues" — scopes the query to the current user\'s assignedUserId and excludes Resolved issues', () => {
    render(<GovernanceDashboardPage />);

    expect(mockUseGovernanceIssues).toHaveBeenCalledWith(
      expect.objectContaining({ assignedUserId: 'user-1', excludeResolved: true }),
    );
  });

  it('shows "My Issues" as the active toggle by default', () => {
    render(<GovernanceDashboardPage />);
    expect(screen.getByRole('button', { name: 'My Issues' })).toHaveClass('bg-brand-600');
  });

  it('defaults to severity-first ordering in "My Issues" view (which issues are most urgent)', () => {
    render(<GovernanceDashboardPage />);
    expect(mockUseGovernanceIssues).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'severity' }));
  });

  it('switches to "All Issues" (org-wide, no assignedUserId/excludeResolved default) when explicitly selected', () => {
    mockSearchParams = new URLSearchParams({ view: 'all' });
    render(<GovernanceDashboardPage />);

    const query = mockUseGovernanceIssues.mock.calls[0][0];
    expect(query.assignedUserId).toBeUndefined();
    expect(query.excludeResolved).toBeUndefined();
  });

  it('clicking "All Issues" navigates with view=all in the URL', () => {
    render(<GovernanceDashboardPage />);
    fireEvent.click(screen.getByRole('button', { name: 'All Issues' }));

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('view=all'));
  });

  it('clicking "My Issues" while on All Issues removes the view param (back to the default)', () => {
    mockSearchParams = new URLSearchParams({ view: 'all' });
    render(<GovernanceDashboardPage />);
    fireEvent.click(screen.getByRole('button', { name: 'My Issues' }));

    const [url] = mockPush.mock.calls[0] as [string];
    expect(url).not.toContain('view=');
  });

  // Regression test for the verified My Issues toggle state bug: starting
  // in All Issues, explicitly selecting another assignee, then clicking My
  // Issues used to leave the explicit assignedUserId filter in place —
  // since explicit filters always win over the default, the list kept
  // showing the OTHER person's issues while the My Issues button rendered
  // as active. Clicking My Issues must now unambiguously establish "my
  // issues" by clearing that conflicting explicit filter.
  it('clicking "My Issues" after explicitly filtering to another assignee clears that filter and resets to the current user\'s issues', () => {
    // 1. Start in All Issues. 2. Select another assignee.
    mockSearchParams = new URLSearchParams({ view: 'all', assignedUserId: 'user-someone-else', page: '3' });
    render(<GovernanceDashboardPage />);

    // Sanity check: before clicking, the page really is showing the other
    // person's issues, not the current user's.
    expect(mockUseGovernanceIssues.mock.calls[0][0].assignedUserId).toBe('user-someone-else');

    // 3. Click My Issues.
    fireEvent.click(screen.getByRole('button', { name: 'My Issues' }));

    // 4. The explicit assignedUserId must be cleared from the resulting URL...
    const [url] = mockPush.mock.calls[0] as [string];
    expect(url).not.toContain('assignedUserId=');
    expect(url).not.toContain('view=');
    // 6. ...and page resets to 1.
    expect(url).not.toContain('page=3');

    // 5. Re-render as the navigation would produce, and confirm the
    // resulting query now genuinely represents the current user's issues.
    mockSearchParams = new URLSearchParams(url.split('?')[1] ?? '');
    mockUseGovernanceIssues.mockClear();
    render(<GovernanceDashboardPage />);

    expect(mockUseGovernanceIssues).toHaveBeenCalledWith(
      expect.objectContaining({ assignedUserId: 'user-1', excludeResolved: true }),
    );
  });

  it('explicit filters (severity, status, issueType) still override the My Issues default in every other context (unaffected by the toggle fix)', () => {
    mockSearchParams = new URLSearchParams({ severity: 'RequiresReview', assignedUserId: 'user-someone-else' });
    render(<GovernanceDashboardPage />);

    expect(mockUseGovernanceIssues).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'RequiresReview', assignedUserId: 'user-someone-else' }),
    );
  });

  it('an explicit assignedUserId filter from the URL overrides the "My Issues" default, not the other way around', () => {
    mockSearchParams = new URLSearchParams({ assignedUserId: 'user-someone-else' });
    render(<GovernanceDashboardPage />);

    expect(mockUseGovernanceIssues).toHaveBeenCalledWith(
      expect.objectContaining({ assignedUserId: 'user-someone-else' }),
    );
  });

  it('an explicit status filter from the URL overrides the excludeResolved default, not the other way around', () => {
    mockSearchParams = new URLSearchParams({ status: 'Resolved' });
    render(<GovernanceDashboardPage />);

    expect(mockUseGovernanceIssues).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'Resolved', excludeResolved: undefined }),
    );
  });

  it('existing filters (severity, issueType) continue to compose with the My Issues default', () => {
    mockSearchParams = new URLSearchParams({ severity: 'RequiresReview', issueType: 'Freshness' });
    render(<GovernanceDashboardPage />);

    expect(mockUseGovernanceIssues).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'RequiresReview',
        issueType: 'Freshness',
        assignedUserId: 'user-1',
        excludeResolved: true,
      }),
    );
  });

  it('passes the exact same effective query to the summary-strip hook as the list hook', () => {
    mockSearchParams = new URLSearchParams({ severity: 'RequiresReview' });
    render(<GovernanceDashboardPage />);

    const listQuery = mockUseGovernanceIssues.mock.calls[0][0];
    const countsQuery = mockUseGovernanceIssueTypeCounts.mock.calls[0][0];
    expect(countsQuery).toEqual(expect.objectContaining({ severity: listQuery.severity, assignedUserId: listQuery.assignedUserId }));
  });

  it('clicking a summary-strip issue-type count applies the existing issueType filter', () => {
    mockUseGovernanceIssueTypeCounts.mockReturnValue({ data: { byType: { Freshness: 12 } }, loading: false, error: undefined });
    render(<GovernanceDashboardPage />);

    fireEvent.click(screen.getByRole('button', { name: /freshness/i }));

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('issueType=Freshness'));
  });

  it('renders a clean empty state in the summary strip when the current view has zero issues', () => {
    render(<GovernanceDashboardPage />);
    expect(screen.getByText('No open governance issues.')).toBeInTheDocument();
  });
});
