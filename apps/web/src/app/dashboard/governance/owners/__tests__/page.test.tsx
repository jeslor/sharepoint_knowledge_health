import { render, screen } from '@testing-library/react';
import type { OwnershipCoverageResponse } from '@sph/types';
import OwnershipCoveragePage from '../page';

const mockUseOwnershipCoverage = jest.fn();

jest.mock('@/lib/api/hooks/use-ownership-coverage', () => ({
  useOwnershipCoverage: () => mockUseOwnershipCoverage(),
}));

const response: OwnershipCoverageResponse = {
  organizationWide: {
    covered: 5,
    noIdentifiableOwner: 1,
    allOwnersInactive: 1,
    notYetScored: 0,
    totalDocuments: 7,
    scoredDocuments: 7,
    coveragePercentage: 71,
  },
  bySite: [
    {
      siteId: 'site-1',
      siteName: 'Team Site',
      covered: 5,
      noIdentifiableOwner: 1,
      allOwnersInactive: 1,
      notYetScored: 0,
      totalDocuments: 7,
      scoredDocuments: 7,
      coveragePercentage: 71,
    },
  ],
  ownerSourceBreakdown: { graphMetadataCount: 4, manualAssignmentCount: 3 },
  identityBreakdown: { activeRegisteredCount: 2, deactivatedRegisteredCount: 1, externalOrUnregisteredCount: 4 },
  calculatedAt: '2026-08-28T00:00:00.000Z',
};

describe('OwnershipCoveragePage (ADR-0024 Phase A)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a loading state while fetching', () => {
    mockUseOwnershipCoverage.mockReturnValue({ data: undefined, loading: true, error: undefined });
    render(<OwnershipCoveragePage />);

    expect(screen.getByRole('status', { name: 'Loading ownership coverage…' })).toBeInTheDocument();
  });

  it('shows an error state when the fetch fails', () => {
    mockUseOwnershipCoverage.mockReturnValue({ data: undefined, loading: false, error: new Error('Network error') });
    render(<OwnershipCoveragePage />);

    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('renders the summary cards, per-site table, and both breakdown charts once loaded', () => {
    mockUseOwnershipCoverage.mockReturnValue({ data: response, loading: false, error: undefined });
    render(<OwnershipCoveragePage />);

    expect(screen.getByText('Total documents')).toBeInTheDocument();
    expect(screen.getByText('Team Site')).toBeInTheDocument();
    expect(screen.getByText('Owner source')).toBeInTheDocument();
    expect(screen.getByText('Owner identity')).toBeInTheDocument();
    expect(screen.getByText('From SharePoint')).toBeInTheDocument();
    expect(screen.getByText('External / unregistered')).toBeInTheDocument();
  });

  it('links back to the Governance page', () => {
    mockUseOwnershipCoverage.mockReturnValue({ data: response, loading: false, error: undefined });
    render(<OwnershipCoveragePage />);

    expect(screen.getByRole('link', { name: 'Back to Governance' })).toHaveAttribute('href', '/dashboard/governance');
  });
});
