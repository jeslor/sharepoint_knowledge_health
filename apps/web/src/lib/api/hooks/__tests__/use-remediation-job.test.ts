import { renderHook, act } from '@testing-library/react';
import type { RemediationJobDetailResponse } from '@sph/types';
import { useRemediationJob } from '../use-remediation-job';
import { getRemediationJob } from '../../endpoints';

jest.mock('../../endpoints');
jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => ({ user: { organizationId: 'org-1' } }),
}));
jest.mock('@/lib/auth/use-access-token', () => ({
  useAccessToken: () => async () => 'token-123',
}));

const mockedGetRemediationJob = getRemediationJob as jest.MockedFunction<typeof getRemediationJob>;

function detail(overrides: Partial<RemediationJobDetailResponse> = {}): RemediationJobDetailResponse {
  return {
    id: 'job-1',
    status: 'Running',
    issueType: 'ReviewStatus',
    nextReviewDueAt: '2026-12-01T00:00:00.000Z',
    initiatedByUserId: 'user-1',
    initiatedByUserName: 'Ada Admin',
    totalCount: 3,
    succeededCount: 0,
    failedCount: 0,
    skippedCount: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    completedAt: null,
    items: [],
    ...overrides,
  };
}

describe('useRemediationJob (P0-7)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('fetches the job with the organization id, jobId, and token', async () => {
    mockedGetRemediationJob.mockResolvedValue(detail({ status: 'Completed' }));
    renderHook(() => useRemediationJob('job-1'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedGetRemediationJob).toHaveBeenCalledWith('org-1', 'job-1', 'token-123');
  });

  it('polls again after the interval while the job is still Running', async () => {
    jest.useFakeTimers();
    mockedGetRemediationJob.mockResolvedValue(detail({ status: 'Running' }));
    const { result } = renderHook(() => useRemediationJob('job-1'));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.data?.status).toBe('Running');
    expect(mockedGetRemediationJob).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(mockedGetRemediationJob).toHaveBeenCalledTimes(2);
  });

  it('stops polling once the job reaches a terminal (Completed) status', async () => {
    jest.useFakeTimers();
    mockedGetRemediationJob
      .mockResolvedValueOnce(detail({ status: 'Running' }))
      .mockResolvedValueOnce(detail({ status: 'Completed', completedAt: '2026-08-01T00:05:00.000Z' }));
    const { result } = renderHook(() => useRemediationJob('job-1'));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.data?.status).toBe('Running');

    // This tick's refetch observes the job has completed.
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(result.current.data?.status).toBe('Completed');
    expect(mockedGetRemediationJob).toHaveBeenCalledTimes(2);

    // No further polling once terminal — advancing well past another
    // interval must not produce a 3rd call.
    await act(async () => {
      jest.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(mockedGetRemediationJob).toHaveBeenCalledTimes(2);
  });

  it('never polls when the job is already Completed on the very first fetch', async () => {
    jest.useFakeTimers();
    mockedGetRemediationJob.mockResolvedValue(detail({ status: 'Completed' }));
    renderHook(() => useRemediationJob('job-1'));

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedGetRemediationJob).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(mockedGetRemediationJob).toHaveBeenCalledTimes(1);
  });

  it('clears the polling interval on unmount', async () => {
    jest.useFakeTimers();
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    mockedGetRemediationJob.mockResolvedValue(detail({ status: 'Running' }));
    const { unmount } = renderHook(() => useRemediationJob('job-1'));

    await act(async () => {
      await Promise.resolve();
    });

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('surfaces an API error', async () => {
    mockedGetRemediationJob.mockRejectedValue(new Error('Remediation job not found'));
    const { result } = renderHook(() => useRemediationJob('job-missing'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error?.message).toBe('Remediation job not found');
    expect(result.current.data).toBeUndefined();
  });
});
