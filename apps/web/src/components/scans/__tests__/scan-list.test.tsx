import { render, screen, within } from '@testing-library/react';
import type { ScanResponse } from '@sph/types';
import { ScanList } from '../scan-list';

function scan(overrides: Partial<ScanResponse> = {}): ScanResponse {
  return {
    id: 'scan-1',
    microsoftTenantId: 'tenant-1',
    triggeredByUserId: 'user-1',
    status: 'Completed',
    startedAt: '2026-07-01T00:00:00.000Z',
    completedAt: '2026-07-01T01:00:00.000Z',
    documentsScanned: 10,
    documentsFailed: 1,
    errorSummary: null,
    createdAt: '2026-07-01T00:00:00.000Z',
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
});
