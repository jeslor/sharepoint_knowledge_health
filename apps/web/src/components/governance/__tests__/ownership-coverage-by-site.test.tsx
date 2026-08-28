import { render, screen, within } from '@testing-library/react';
import type { OwnershipCoverageBySite } from '@sph/types';
import { OwnershipCoverageBySiteTable } from '../ownership-coverage-by-site';

function site(overrides: Partial<OwnershipCoverageBySite> = {}): OwnershipCoverageBySite {
  return {
    siteId: 'site-1',
    siteName: 'Team Site',
    covered: 4,
    noIdentifiableOwner: 1,
    allOwnersInactive: 0,
    notYetScored: 0,
    totalDocuments: 5,
    scoredDocuments: 5,
    coveragePercentage: 80,
    ...overrides,
  };
}

describe('OwnershipCoverageBySiteTable (ADR-0024 Phase A)', () => {
  it('renders the empty state when there are no sites', () => {
    render(<OwnershipCoverageBySiteTable sites={[]} />);
    expect(screen.getByText('No sites with active documents yet.')).toBeInTheDocument();
  });

  it('renders a row per site with its counts and coverage percentage', () => {
    render(<OwnershipCoverageBySiteTable sites={[site()]} />);

    const [row] = screen.getAllByRole('row').slice(1);
    expect(row).toBeDefined();
    const cells = row ? within(row).getAllByRole('cell') : [];
    expect(cells[0]).toHaveTextContent('Team Site');
    expect(cells[1]).toHaveTextContent('5');
    expect(cells[2]).toHaveTextContent('4');
    expect(cells[6]).toHaveTextContent('80%');
  });

  it('renders "Not yet scored" instead of a misleading 0% for a site with no scored documents yet', () => {
    render(
      <OwnershipCoverageBySiteTable
        sites={[site({ covered: 0, noIdentifiableOwner: 0, allOwnersInactive: 0, notYetScored: 3, scoredDocuments: 0, totalDocuments: 3, coveragePercentage: null })]}
      />,
    );

    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    // Two occurrences: the "Not yet scored" column header, and the row's
    // own coverage cell (in place of a misleading "0%").
    expect(screen.getAllByText('Not yet scored')).toHaveLength(2);
  });

  it('includes a site that still has active documents even if it is not Approved (Invariant 4)', () => {
    render(<OwnershipCoverageBySiteTable sites={[site({ siteId: 'site-removed', siteName: 'Old Site' })]} />);

    expect(screen.getByText('Old Site')).toBeInTheDocument();
  });
});
