import { render, screen } from '@testing-library/react';
import type { HealthSummaryResponse } from '@sph/types';
import { OrganizationHealthHero } from '../organization-health-hero';

function summary(overrides: Partial<HealthSummaryResponse> = {}): HealthSummaryResponse {
  return {
    totalDocumentsScanned: 1204,
    averageHealthScore: 62,
    criticalIssuesCount: 12,
    warningIssuesCount: 34,
    lastSuccessfulScanAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    currentScanStatus: null,
    ...overrides,
  };
}

describe('OrganizationHealthHero', () => {
  it('renders the score, band message, and supporting stats', () => {
    render(<OrganizationHealthHero summary={summary()} />);

    expect(screen.getByText('62')).toBeInTheDocument();
    expect(screen.getByText('/100')).toBeInTheDocument();
    expect(screen.getByText('Your SharePoint environment requires attention.')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('1204')).toBeInTheDocument();
  });

  it('shows a healthy message once the score reaches the Healthy band (90+)', () => {
    render(<OrganizationHealthHero summary={summary({ averageHealthScore: 95 })} />);
    expect(screen.getByText('Your SharePoint environment is in good health.')).toBeInTheDocument();
  });

  it('shows a needs-attention message in the 70-89 band', () => {
    render(<OrganizationHealthHero summary={summary({ averageHealthScore: 75 })} />);
    expect(screen.getByText('Your SharePoint environment needs attention in a few areas.')).toBeInTheDocument();
  });

  it('handles a null score (no scans yet) without crashing', () => {
    render(<OrganizationHealthHero summary={summary({ averageHealthScore: null, lastSuccessfulScanAt: null })} />);
    expect(screen.getByText('Run your first scan to see your organization’s health score.')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('links the primary action to the filtered critical-documents view', () => {
    render(<OrganizationHealthHero summary={summary()} />);
    expect(screen.getByRole('link', { name: 'View critical issues' })).toHaveAttribute(
      'href',
      '/dashboard/documents?severity=RequiresReview',
    );
  });
});
