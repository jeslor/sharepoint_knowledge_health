import { render, screen } from '@testing-library/react';
import type { GovernanceSummaryResponse } from '@sph/types';
import { CriticalIssuesCard } from '../critical-issues-card';

function summary(overrides: Partial<GovernanceSummaryResponse> = {}): GovernanceSummaryResponse {
  return {
    openCount: 200,
    inProgressCount: 10,
    resolvedCount: 5,
    criticalCount: 150,
    assignedCount: 20,
    byType: {},
    totalCount: 215,
    averageResolutionTimeHours: null,
    createdThisMonth: 10,
    resolvedThisMonth: 5,
    completionRate: 2,
    ...overrides,
  };
}

describe('CriticalIssuesCard', () => {
  it('shows an empty state when there are no open issues by type', () => {
    render(<CriticalIssuesCard summary={summary({ byType: {} })} />);
    expect(screen.getByText('No critical issues found.')).toBeInTheDocument();
    expect(screen.getByText('Your SharePoint environment is healthy.')).toBeInTheDocument();
  });

  it('lists the top issue types by count, largest first, with a review action linking to the filtered governance list', () => {
    render(<CriticalIssuesCard summary={summary({ byType: { ReviewStatus: 142, Ownership: 30, Freshness: 8 } })} />);

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Documents without a scheduled review');
    expect(items[0]).toHaveTextContent('142 documents require review scheduling');

    const links = screen.getAllByRole('link', { name: 'Review documents' });
    // view=all so the drill-down matches this card's ORG-WIDE counts, instead
    // of the governance page's default "My Issues" (view=mine) scope.
    expect(links[0]).toHaveAttribute('href', '/dashboard/governance?issueType=ReviewStatus&view=all');
  });

  it('links every issue type to the organization-wide (view=all) governance view, filtered to that type', () => {
    render(<CriticalIssuesCard summary={summary({ byType: { Ownership: 40, ReviewStatus: 30, Taxonomy: 20, Metadata: 10 } })} />);

    const links = screen.getAllByRole('link', { name: 'Review documents' });
    const hrefs = links.map((link) => link.getAttribute('href'));

    // Every drill-down carries view=all (systemic, not Ownership-specific)...
    expect(hrefs.every((href) => href?.includes('view=all'))).toBe(true);
    // ...and each is scoped to its own issue type.
    expect(hrefs).toEqual([
      '/dashboard/governance?issueType=Ownership&view=all',
      '/dashboard/governance?issueType=ReviewStatus&view=all',
      '/dashboard/governance?issueType=Taxonomy&view=all',
      '/dashboard/governance?issueType=Metadata&view=all',
    ]);
  });

  it('caps the list at the top 4 issue types even when more exist', () => {
    render(
      <CriticalIssuesCard
        summary={summary({
          byType: { ReviewStatus: 100, Ownership: 90, Freshness: 80, Metadata: 70, Duplication: 60, Age: 50 },
        })}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('shows the total critical count in the header', () => {
    render(<CriticalIssuesCard summary={summary({ criticalCount: 150, byType: { Ownership: 5 } })} />);
    expect(screen.getByText('150 total')).toBeInTheDocument();
  });
});
