import { renderHook, act } from '@testing-library/react';
import { useReviewDateEligibility } from '../use-review-date-eligibility';
import { checkReviewDateEligibility } from '../../endpoints';

jest.mock('../../endpoints');
jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => ({ user: { organizationId: 'org-1' } }),
}));
jest.mock('@/lib/auth/use-access-token', () => ({
  useAccessToken: () => async () => 'token-123',
}));

const mockedCheckReviewDateEligibility = checkReviewDateEligibility as jest.MockedFunction<typeof checkReviewDateEligibility>;

describe('useReviewDateEligibility', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts with result undefined — "not checked yet" is distinct from any checked outcome', () => {
    const { result } = renderHook(() => useReviewDateEligibility('site-1', 'list-1'));

    expect(result.current.result).toBeUndefined();
    expect(result.current.checking).toBe(false);
  });

  it('never calls the endpoint until check() is invoked', () => {
    renderHook(() => useReviewDateEligibility('site-1', 'list-1'));

    expect(mockedCheckReviewDateEligibility).not.toHaveBeenCalled();
  });

  it('populates result with the NoEligibleColumn outcome after check()', async () => {
    mockedCheckReviewDateEligibility.mockResolvedValue({ status: 'NoEligibleColumn' });
    const { result } = renderHook(() => useReviewDateEligibility('site-1', 'list-1'));

    await act(() => result.current.check());

    expect(result.current.result).toEqual({ status: 'NoEligibleColumn' });
    expect(mockedCheckReviewDateEligibility).toHaveBeenCalledWith('org-1', 'site-1', 'list-1', 'token-123');
  });

  it('populates result with a SingleEligibleColumn outcome', async () => {
    const response = {
      status: 'SingleEligibleColumn' as const,
      column: { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', confidence: 'high' as const },
    };
    mockedCheckReviewDateEligibility.mockResolvedValue(response);
    const { result } = renderHook(() => useReviewDateEligibility('site-1', 'list-1'));

    await act(() => result.current.check());

    expect(result.current.result).toEqual(response);
  });

  it('sets checking true only while the request is in flight', async () => {
    let resolveCheck!: (value: { status: 'NoEligibleColumn' }) => void;
    mockedCheckReviewDateEligibility.mockReturnValue(new Promise((resolve) => (resolveCheck = resolve)));
    const { result } = renderHook(() => useReviewDateEligibility('site-1', 'list-1'));

    let checkPromise!: Promise<void>;
    act(() => {
      checkPromise = result.current.check();
    });
    expect(result.current.checking).toBe(true);

    await act(async () => {
      resolveCheck({ status: 'NoEligibleColumn' });
      await checkPromise;
    });
    expect(result.current.checking).toBe(false);
  });

  it('surfaces a check error without setting result', async () => {
    mockedCheckReviewDateEligibility.mockRejectedValue(new Error('Graph unavailable'));
    const { result } = renderHook(() => useReviewDateEligibility('site-1', 'list-1'));

    await act(() => result.current.check());

    expect(result.current.checkError?.message).toBe('Graph unavailable');
    expect(result.current.result).toBeUndefined();
  });

  it('re-running check() after a fresh column appears reflects the new live state — never reuses the stale result', async () => {
    mockedCheckReviewDateEligibility.mockResolvedValueOnce({ status: 'NoEligibleColumn' });
    const { result } = renderHook(() => useReviewDateEligibility('site-1', 'list-1'));
    await act(() => result.current.check());
    expect(result.current.result).toEqual({ status: 'NoEligibleColumn' });

    mockedCheckReviewDateEligibility.mockResolvedValueOnce({
      status: 'SingleEligibleColumn',
      column: { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', confidence: 'high' },
    });
    await act(() => result.current.check());

    expect(result.current.result?.status).toBe('SingleEligibleColumn');
  });
});
