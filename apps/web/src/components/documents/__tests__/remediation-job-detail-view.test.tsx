import { render, screen, within } from '@testing-library/react';
import type { RemediationJobDetailResponse } from '@sph/types';
import { RemediationJobDetailView } from '../remediation-job-detail-view';

const mockUseRemediationJob = jest.fn();

jest.mock('@/lib/api/hooks/use-remediation-job', () => ({
  useRemediationJob: (jobId: string) => mockUseRemediationJob(jobId),
}));

function detail(overrides: Partial<RemediationJobDetailResponse> = {}): RemediationJobDetailResponse {
  return {
    id: 'job-1',
    status: 'Completed',
    issueType: 'ReviewStatus',
    nextReviewDueAt: '2026-12-01T00:00:00.000Z',
    initiatedByUserId: 'user-1',
    initiatedByUserName: 'Ada Admin',
    totalCount: 3,
    succeededCount: 2,
    failedCount: 1,
    skippedCount: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    completedAt: '2026-08-01T00:05:00.000Z',
    items: [
      { documentId: 'doc-1', documentName: 'Doc One.docx', status: 'Succeeded', errorType: null, errorMessage: null, attemptCount: 1 },
      {
        documentId: 'doc-2',
        documentName: 'Doc Two.pdf',
        status: 'Failed',
        errorType: 'GraphNotFoundError',
        errorMessage: 'The item was not found',
        attemptCount: 2,
      },
    ],
    ...overrides,
  };
}

// P0-7 (ADR-0022 Phase 7): the presentational half of the job-detail/progress
// page, split out specifically so it's directly unit-testable (the page
// itself only unwraps Next.js 15's `use(params)`, which this test
// environment's React build doesn't support rendering directly).
describe('RemediationJobDetailView (P0-7)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches the exact jobId it was given', () => {
    mockUseRemediationJob.mockReturnValue({ data: detail(), loading: false, error: undefined });
    render(<RemediationJobDetailView jobId="job-42" />);

    expect(mockUseRemediationJob).toHaveBeenCalledWith('job-42');
  });

  it('renders the job summary: status, counts, and timestamps', () => {
    mockUseRemediationJob.mockReturnValue({ data: detail(), loading: false, error: undefined });
    render(<RemediationJobDetailView jobId="job-1" />);

    const heading = screen.getByRole('heading', { name: 'Remediation job' });
    expect(heading.parentElement && within(heading.parentElement).getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Ada Admin')).toBeInTheDocument();
    expect(screen.getByText(new Date('2026-08-01T00:00:00.000Z').toLocaleString())).toBeInTheDocument();
    expect(screen.getByText(new Date('2026-08-01T00:05:00.000Z').toLocaleString())).toBeInTheDocument();

    const summary = screen.getByText('Total documents').closest('dl');
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent('3');
    expect(summary).toHaveTextContent('2');
    expect(summary).toHaveTextContent('1');
  });

  it('renders individual item results, distinguishing succeeded from failed', () => {
    mockUseRemediationJob.mockReturnValue({ data: detail(), loading: false, error: undefined });
    render(<RemediationJobDetailView jobId="job-1" />);

    // ADR-0022 write-back MVP: rows now label by document name, linking by id.
    expect(screen.getByRole('link', { name: 'Doc One.docx' })).toHaveAttribute('href', '/dashboard/documents/doc-1');
    expect(screen.getByRole('link', { name: 'Doc Two.pdf' })).toHaveAttribute('href', '/dashboard/documents/doc-2');
    expect(screen.getByText(/GraphNotFoundError/)).toBeInTheDocument();
    expect(screen.getByText(/The item was not found/)).toBeInTheDocument();
  });

  it('shows a loading state while the job is being fetched', () => {
    mockUseRemediationJob.mockReturnValue({ data: undefined, loading: true, error: undefined });
    render(<RemediationJobDetailView jobId="job-1" />);

    expect(screen.getByRole('status', { name: 'Loading remediation job…' })).toBeInTheDocument();
  });

  it('shows an error state when the fetch fails', () => {
    mockUseRemediationJob.mockReturnValue({ data: undefined, loading: false, error: new Error('Remediation job not found') });
    render(<RemediationJobDetailView jobId="job-1" />);

    expect(screen.getByText('Remediation job not found')).toBeInTheDocument();
  });

  it('shows a spinner while the job is Running', () => {
    mockUseRemediationJob.mockReturnValue({
      data: detail({ status: 'Running', completedAt: null }),
      loading: false,
      error: undefined,
    });
    render(<RemediationJobDetailView jobId="job-1" />);

    const heading = screen.getByRole('heading', { name: 'Remediation job' });
    expect(heading.parentElement?.querySelector('svg')).toBeInTheDocument();
  });

  it('shows no spinner once the job is Completed', () => {
    mockUseRemediationJob.mockReturnValue({ data: detail({ status: 'Completed' }), loading: false, error: undefined });
    render(<RemediationJobDetailView jobId="job-1" />);

    const heading = screen.getByRole('heading', { name: 'Remediation job' });
    expect(heading.parentElement?.querySelector('svg')).not.toBeInTheDocument();
  });
});
