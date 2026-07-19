import { render, screen } from '@testing-library/react';
import type { ScanResponse } from '@sph/types';
import { RecentScansCard } from '../recent-scans-card';

function scan(overrides: Partial<ScanResponse> = {}): ScanResponse {
  return {
    id: 'scan-1',
    microsoftTenantId: 'tenant-1',
    triggeredByUserId: 'user-1',
    triggerSource: 'Manual',
    status: 'Completed',
    startedAt: '2026-07-19T10:00:00.000Z',
    completedAt: '2026-07-19T10:02:00.000Z',
    documentsScanned: 1204,
    documentsFailed: 0,
    errorSummary: null,
    createdAt: '2026-07-19T09:59:00.000Z',
    totalSites: 5,
    sitesCompleted: 5,
    currentSiteName: null,
    ...overrides,
  };
}

describe('RecentScansCard', () => {
  it('shows an empty state when no scans have run yet', () => {
    render(<RecentScansCard scans={[]} />);
    expect(screen.getByText('No scans have been run yet.')).toBeInTheDocument();
  });

  it('shows the most recent scan\'s status, duration, and document count', () => {
    render(<RecentScansCard scans={[scan(), scan({ id: 'scan-0', startedAt: '2026-07-18T00:00:00.000Z' })]} />);

    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('2m')).toBeInTheDocument();
    expect(screen.getByText('1204')).toBeInTheDocument();
  });

  it('links to the scan detail page and the full scans list', () => {
    render(<RecentScansCard scans={[scan()]} />);
    expect(screen.getByRole('link', { name: 'View details' })).toHaveAttribute('href', '/dashboard/scans/scan-1');
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/dashboard/scans');
  });
});
