import { render, screen, fireEvent } from '@testing-library/react';
import RemediationJobsPage from '../page';

const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();

const mockUseRemediationJobs = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock('@/lib/api/hooks/use-remediation-jobs', () => ({
  useRemediationJobs: (query: unknown) => mockUseRemediationJobs(query),
}));

const job = {
  id: 'job-1',
  status: 'Completed' as const,
  issueType: 'ReviewStatus' as const,
  nextReviewDueAt: '2026-12-01T00:00:00.000Z',
  initiatedByUserId: 'user-1',
  initiatedByUserName: 'Ada Admin',
  totalCount: 5,
  succeededCount: 4,
  failedCount: 1,
  skippedCount: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  completedAt: '2026-08-01T00:05:00.000Z',
};

// P0-7 (ADR-0022 Phase 7): mirrors audit-log/page.tsx's URL-search-param
// pagination — these prove the page-level wiring (query built from
// searchParams, Pagination's onPageChange pushes the right URL), not
// RemediationJobList's own rendering (covered directly by its own tests).
describe('RemediationJobsPage (P0-7 — history)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it('fetches from the hook with the page parsed from the URL', () => {
    mockSearchParams = new URLSearchParams({ page: '3' });
    mockUseRemediationJobs.mockReturnValue({
      data: { data: [job], pagination: { page: 3, pageSize: 25, total: 60, totalPages: 3 } },
      loading: false,
      error: undefined,
    });

    render(<RemediationJobsPage />);

    expect(mockUseRemediationJobs).toHaveBeenCalledWith({ page: 3 });
  });

  it('renders jobs returned by the hook', () => {
    mockUseRemediationJobs.mockReturnValue({
      data: { data: [job], pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 } },
      loading: false,
      error: undefined,
    });

    render(<RemediationJobsPage />);

    expect(screen.getByText('Ada Admin')).toBeInTheDocument();
  });

  it('shows the empty state when there are no jobs', () => {
    mockUseRemediationJobs.mockReturnValue({
      data: { data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } },
      loading: false,
      error: undefined,
    });

    render(<RemediationJobsPage />);

    expect(screen.getByText('No remediation jobs yet.')).toBeInTheDocument();
  });

  it('shows a loading state while fetching', () => {
    mockUseRemediationJobs.mockReturnValue({ data: undefined, loading: true, error: undefined });

    render(<RemediationJobsPage />);

    expect(screen.getByRole('status', { name: 'Loading remediation jobs…' })).toBeInTheDocument();
  });

  it('shows an error state when the fetch fails', () => {
    mockUseRemediationJobs.mockReturnValue({ data: undefined, loading: false, error: new Error('Network error') });

    render(<RemediationJobsPage />);

    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('navigates with the next page number when Pagination is used, following the existing page/pageSize convention', () => {
    mockUseRemediationJobs.mockReturnValue({
      data: { data: [job], pagination: { page: 1, pageSize: 25, total: 60, totalPages: 3 } },
      loading: false,
      error: undefined,
    });

    render(<RemediationJobsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('page=2'));
  });
});
