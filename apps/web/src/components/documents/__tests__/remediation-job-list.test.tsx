import { render, screen, within } from '@testing-library/react';
import type { RemediationJobSummary } from '@sph/types';
import { RemediationJobList } from '../remediation-job-list';

function job(overrides: Partial<RemediationJobSummary> = {}): RemediationJobSummary {
  return {
    id: 'job-1',
    status: 'Completed',
    issueType: 'ReviewStatus',
    nextReviewDueAt: '2026-12-01T00:00:00.000Z',
    initiatedByUserId: 'user-1',
    initiatedByUserName: 'Ada Admin',
    totalCount: 10,
    succeededCount: 8,
    failedCount: 1,
    skippedCount: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    completedAt: '2026-08-01T01:00:00.000Z',
    ...overrides,
  };
}

describe('RemediationJobList (P0-7)', () => {
  it('renders the empty state when there are no jobs', () => {
    render(<RemediationJobList jobs={[]} />);
    expect(screen.getByText('No remediation jobs yet.')).toBeInTheDocument();
  });

  it.each(['Running', 'Completed'])('renders the real %s status value as a badge, not an invented label', (status) => {
    render(<RemediationJobList jobs={[job({ status: status as 'Running' | 'Completed' })]} />);
    const [row] = screen.getAllByRole('row').slice(1);
    expect(row).toBeDefined();
    expect(row && within(row).getByText(status)).toBeInTheDocument();
  });

  it('renders initiator, total/succeeded/failed/skipped counts, and timestamps in the documented column order', () => {
    render(<RemediationJobList jobs={[job({ totalCount: 10, succeededCount: 6, failedCount: 3, skippedCount: 1 })]} />);

    const [row] = screen.getAllByRole('row').slice(1);
    expect(row).toBeDefined();
    const cells = row ? within(row).getAllByRole('cell') : [];
    // Status, Initiated by, Total, Succeeded, Failed, Skipped, Created, Completed, View.
    expect(cells[1]).toHaveTextContent('Ada Admin');
    expect(cells[2]).toHaveTextContent('10');
    expect(cells[3]).toHaveTextContent('6');
    expect(cells[4]).toHaveTextContent('3');
    expect(cells[5]).toHaveTextContent('1');
    expect(cells[6]).toHaveTextContent(new Date('2026-08-01T00:00:00.000Z').toLocaleString());
    expect(cells[7]).toHaveTextContent(new Date('2026-08-01T01:00:00.000Z').toLocaleString());
  });

  it('shows an em dash for completedAt when the job has not finished yet', () => {
    render(<RemediationJobList jobs={[job({ status: 'Running', completedAt: null })]} />);

    const [row] = screen.getAllByRole('row').slice(1);
    expect(row).toBeDefined();
    expect(row && within(row).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows a spinner for a Running job but not for a Completed one', () => {
    const { rerender } = render(<RemediationJobList jobs={[job({ status: 'Running' })]} />);
    let [row] = screen.getAllByRole('row').slice(1);
    expect(row && row.querySelector('svg')).toBeInTheDocument();

    rerender(<RemediationJobList jobs={[job({ status: 'Completed' })]} />);
    [row] = screen.getAllByRole('row').slice(1);
    expect(row && row.querySelector('svg')).not.toBeInTheDocument();
  });

  it('links each row to its detail page', () => {
    render(<RemediationJobList jobs={[job({ id: 'job-42' })]} />);

    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/dashboard/documents/remediation-jobs/job-42');
  });
});
