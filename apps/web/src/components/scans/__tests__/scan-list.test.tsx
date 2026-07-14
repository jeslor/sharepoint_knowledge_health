import { render, screen, within } from '@testing-library/react';
import type { ScanResponse } from '@sph/types';
import { ScanList } from '../scan-list';

function scan(overrides: Partial<ScanResponse> = {}): ScanResponse {
  return {
    id: 'scan-1',
    microsoftTenantId: 'tenant-1',
    triggeredByUserId: 'user-1',
    triggerSource: 'Manual',
    status: 'Completed',
    startedAt: '2026-07-01T00:00:00.000Z',
    completedAt: '2026-07-01T01:00:00.000Z',
    documentsScanned: 10,
    documentsFailed: 1,
    errorSummary: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    totalSites: 3,
    sitesCompleted: 3,
    currentSiteName: null,
    ...overrides,
  };
}

describe('ScanList', () => {
  it('renders the empty state when there are no scans', () => {
    render(<ScanList scans={[]} />);

    expect(screen.getByText('No scans have been run yet.')).toBeInTheDocument();
  });

  it.each(['Queued', 'Running', 'Completed', 'Failed', 'Cancelled'])(
    'renders the real %s status value as a badge, not an invented label',
    (status) => {
      render(<ScanList scans={[scan({ status })]} />);
      // Scoped to table body cells — "Completed" is also a column header.
      const [row] = screen.getAllByRole('row').slice(1);
      expect(row).toBeDefined();
      expect(row && within(row).getByText(status)).toBeInTheDocument();
    },
  );

  it('renders documentsScanned, documentsFailed, and errorSummary for a failed scan', () => {
    render(<ScanList scans={[scan({ status: 'Failed', errorSummary: 'Site X: Graph unavailable' })]} />);

    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Site X: Graph unavailable')).toBeInTheDocument();
  });

  describe('progress column (ADR-0015 §5)', () => {
    it('shows "Preparing…" for a Running scan before the worker reports totalSites', () => {
      render(<ScanList scans={[scan({ status: 'Running', totalSites: null, sitesCompleted: 0, currentSiteName: null })]} />);

      expect(screen.getByText('Preparing…')).toBeInTheDocument();
    });

    it('shows the current site and count for a Running scan mid-progress', () => {
      render(
        <ScanList
          scans={[scan({ status: 'Running', totalSites: 5, sitesCompleted: 2, currentSiteName: 'Marketing Docs' })]}
        />,
      );

      expect(screen.getByText('Site 2 of 5: Marketing Docs')).toBeInTheDocument();
    });

    it('shows no progress text for a terminal-status scan, even if progress fields are populated', () => {
      render(<ScanList scans={[scan({ status: 'Completed', totalSites: 5, sitesCompleted: 5, currentSiteName: null })]} />);

      const [row] = screen.getAllByRole('row').slice(1);
      expect(row).toBeDefined();
      // Progress is the 2nd cell — "—" for a terminal scan, not stale progress text.
      expect(row && within(row).getAllByText('—').length).toBeGreaterThan(0);
      expect(screen.queryByText(/Site \d+ of \d+/)).not.toBeInTheDocument();
    });
  });
});
