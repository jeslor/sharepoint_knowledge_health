import { render, screen } from '@testing-library/react';
import type { HealthSummaryResponse } from '@sph/types';
import { OverviewCards } from '../overview-cards';

const summary: HealthSummaryResponse = {
  totalDocumentsScanned: 42,
  averageHealthScore: 78,
  criticalIssuesCount: 3,
  warningIssuesCount: 9,
  lastSuccessfulScanAt: '2026-07-10T12:00:00.000Z',
  currentScanStatus: 'Completed',
};

describe('OverviewCards', () => {
  it('renders all 6 required organization overview stats', () => {
    render(<OverviewCards summary={summary} />);

    expect(screen.getByText('Total documents scanned')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Average health score')).toBeInTheDocument();
    expect(screen.getByText('78/100')).toBeInTheDocument();
    expect(screen.getByText('Critical issues')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Warning issues')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('Last successful scan')).toBeInTheDocument();
    expect(screen.getByText('Current scan status')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('shows placeholders for a never-scanned organization (empty state)', () => {
    render(
      <OverviewCards
        summary={{
          totalDocumentsScanned: 0,
          averageHealthScore: null,
          criticalIssuesCount: 0,
          warningIssuesCount: 0,
          lastSuccessfulScanAt: null,
          currentScanStatus: null,
        }}
      />,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.getByText('Never run')).toBeInTheDocument();
  });
});
