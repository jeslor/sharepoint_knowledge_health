import { render, screen } from '@testing-library/react';
import type { OwnershipCoverageBucket } from '@sph/types';
import { OwnershipSummaryCards } from '../ownership-summary-cards';

function bucket(overrides: Partial<OwnershipCoverageBucket> = {}): OwnershipCoverageBucket {
  return {
    covered: 5,
    noIdentifiableOwner: 1,
    allOwnersInactive: 1,
    notYetScored: 0,
    totalDocuments: 7,
    scoredDocuments: 7,
    coveragePercentage: 71,
    ...overrides,
  };
}

describe('OwnershipSummaryCards (ADR-0024 Phase A)', () => {
  it('renders total documents, no-identifiable-owner, all-owners-deactivated, and not-yet-scored counts', () => {
    render(<OwnershipSummaryCards bucket={bucket()} />);

    expect(screen.getByText('Total documents')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('No identifiable owner')).toBeInTheDocument();
    expect(screen.getByText('All owners deactivated')).toBeInTheDocument();
    expect(screen.getByText('Not yet scored')).toBeInTheDocument();
  });

  it('renders the coverage percentage when it is a real number', () => {
    render(<OwnershipSummaryCards bucket={bucket({ coveragePercentage: 71 })} />);

    expect(screen.getByText('71%')).toBeInTheDocument();
  });

  it('renders "Not yet scored" instead of a misleading 0% when coveragePercentage is null (Invariant 3)', () => {
    render(
      <OwnershipSummaryCards
        bucket={bucket({
          coveragePercentage: null,
          covered: 0,
          noIdentifiableOwner: 0,
          allOwnersInactive: 0,
          scoredDocuments: 0,
          notYetScored: 7,
          totalDocuments: 7,
        })}
      />,
    );

    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    // Two occurrences: the "Not yet scored" metric tile's own label, and
    // the coverage tile's value (in place of a misleading "0%").
    expect(screen.getAllByText('Not yet scored')).toHaveLength(2);
  });
});
