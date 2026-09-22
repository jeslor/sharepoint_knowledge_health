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
    limitReached: false,
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

  // Phase 5: a normal completed scan (limitReached: false) must render
  // exactly as before — no trial messaging appears unless the backend says so.
  it('shows no trial-limit badge for a normal completed scan', () => {
    render(<RecentScansCard scans={[scan({ limitReached: false })]} />);
    expect(screen.queryByText('Trial limit reached')).not.toBeInTheDocument();
  });

  it('shows a trial-limit badge next to the status when the most recent scan reached the trial limit', () => {
    render(<RecentScansCard scans={[scan({ limitReached: true })]} />);
    expect(screen.getByText('Trial limit reached')).toBeInTheDocument();
    // Still shown as a normal Completed scan, never as a failure.
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });
});
