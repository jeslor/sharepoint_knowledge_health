import { renderHook, act } from '@testing-library/react';
import { useCreateRemediationJob } from '../use-create-remediation-job';
import { createRemediationJob } from '../../endpoints';

jest.mock('../../endpoints');
jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => ({ user: { organizationId: 'org-1' } }),
}));
jest.mock('@/lib/auth/use-access-token', () => ({
  useAccessToken: () => async () => 'token-123',
}));

const mockedCreateRemediationJob = createRemediationJob as jest.MockedFunction<typeof createRemediationJob>;

const request = {
  issueType: 'ReviewStatus' as const,
  documentIds: ['doc-1', 'doc-2'],
  nextReviewDueAt: '2026-12-01T00:00:00.000Z',
};

const response = { remediationJobId: 'job-1', totalCount: 2, ineligibleDocumentIds: [] };

describe('useCreateRemediationJob (P0-6)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls createRemediationJob with the organization id, token, and the exact request body', async () => {
    mockedCreateRemediationJob.mockResolvedValue(response);
    const { result } = renderHook(() => useCreateRemediationJob());

    await act(async () => {
      await result.current.submit(request);
    });

    expect(mockedCreateRemediationJob).toHaveBeenCalledWith('org-1', 'token-123', request);
  });

  it('returns the response on success', async () => {
    mockedCreateRemediationJob.mockResolvedValue(response);
    const { result } = renderHook(() => useCreateRemediationJob());

    let returned;
    await act(async () => {
      returned = await result.current.submit(request);
    });

    expect(returned).toEqual(response);
  });

  it('surfaces an error and returns undefined on failure — the caller must not assume success', async () => {
    mockedCreateRemediationJob.mockRejectedValue(new Error('None of the submitted documents are eligible for remediation'));
    const { result } = renderHook(() => useCreateRemediationJob());

    let returned;
    await act(async () => {
      returned = await result.current.submit(request);
    });

    expect(returned).toBeUndefined();
    expect(result.current.submitError?.message).toBe('None of the submitted documents are eligible for remediation');
  });

  it('sets submitting true only while the request is in flight', async () => {
    let resolveSubmit!: (value: typeof response) => void;
    mockedCreateRemediationJob.mockReturnValue(new Promise((resolve) => (resolveSubmit = resolve)));
    const { result } = renderHook(() => useCreateRemediationJob());

    let submitPromise!: Promise<unknown>;
    act(() => {
      submitPromise = result.current.submit(request);
    });
    expect(result.current.submitting).toBe(true);

    await act(async () => {
      resolveSubmit(response);
      await submitPromise;
    });
    expect(result.current.submitting).toBe(false);
  });

  it('clears a previous error at the start of a new submission', async () => {
    mockedCreateRemediationJob.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useCreateRemediationJob());

    await act(async () => {
      await result.current.submit(request);
    });
    expect(result.current.submitError).toBeDefined();

    mockedCreateRemediationJob.mockResolvedValueOnce(response);
    await act(async () => {
      await result.current.submit(request);
    });
    expect(result.current.submitError).toBeUndefined();
  });
});
