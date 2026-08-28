import { renderHook, act } from '@testing-library/react';
import type { PaginatedResponse, RemediationJobSummary } from '@sph/types';
import { useRemediationJobs } from '../use-remediation-jobs';
import { listRemediationJobs } from '../../endpoints';

jest.mock('../../endpoints');
jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => ({ user: { organizationId: 'org-1' } }),
}));
jest.mock('@/lib/auth/use-access-token', () => ({
  useAccessToken: () => async () => 'token-123',
}));

const mockedListRemediationJobs = listRemediationJobs as jest.MockedFunction<typeof listRemediationJobs>;

const page: PaginatedResponse<RemediationJobSummary> = {
  data: [],
  pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 },
};

describe('useRemediationJobs (P0-7)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches with the organization id, token, and the given page/pageSize', async () => {
    mockedListRemediationJobs.mockResolvedValue(page);
    renderHook(() => useRemediationJobs({ page: 2, pageSize: 10 }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedListRemediationJobs).toHaveBeenCalledWith('org-1', 'token-123', { page: 2, pageSize: 10 });
  });

  it('refetches when the page changes', async () => {
    mockedListRemediationJobs.mockResolvedValue(page);
    const { rerender } = renderHook(({ query }) => useRemediationJobs(query), { initialProps: { query: { page: 1 } } });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedListRemediationJobs).toHaveBeenCalledTimes(1);

    rerender({ query: { page: 2 } });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedListRemediationJobs).toHaveBeenCalledTimes(2);
    expect(mockedListRemediationJobs).toHaveBeenLastCalledWith('org-1', 'token-123', { page: 2 });
  });

  it('returns the paginated response as-is', async () => {
    const populated: PaginatedResponse<RemediationJobSummary> = {
      data: [
        {
          id: 'job-1',
          status: 'Completed',
          issueType: 'ReviewStatus',
          nextReviewDueAt: null,
          initiatedByUserId: 'user-1',
          initiatedByUserName: 'Ada Admin',
          totalCount: 1,
          succeededCount: 1,
          failedCount: 0,
          skippedCount: 0,
          createdAt: '2026-08-01T00:00:00.000Z',
          completedAt: '2026-08-01T00:01:00.000Z',
        },
      ],
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    };
    mockedListRemediationJobs.mockResolvedValue(populated);
    const { result } = renderHook(() => useRemediationJobs({}));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.data).toEqual(populated);
  });
});
