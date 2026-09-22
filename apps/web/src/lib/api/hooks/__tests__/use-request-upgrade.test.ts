import { renderHook, act } from '@testing-library/react';
import type { RequestUpgradeResponse } from '@sph/types';
import { useRequestUpgrade } from '../use-request-upgrade';
import { requestUpgrade } from '../../endpoints';

jest.mock('../../endpoints');
jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => ({ user: { organizationId: 'org-1' } }),
}));
jest.mock('@/lib/auth/use-access-token', () => ({
  useAccessToken: () => async () => 'token-123',
}));

const mockedRequestUpgrade = requestUpgrade as jest.MockedFunction<typeof requestUpgrade>;

const response: RequestUpgradeResponse = { id: 'req-1', status: 'Pending', createdAt: '2026-09-22T12:30:00.000Z' };

describe('useRequestUpgrade (Phase 6)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('submits with the organization id, token, and message', async () => {
    mockedRequestUpgrade.mockResolvedValue(response);
    const { result } = renderHook(() => useRequestUpgrade());

    await act(async () => {
      await result.current.submit('We need more capacity.');
    });

    expect(mockedRequestUpgrade).toHaveBeenCalledWith('org-1', 'token-123', { message: 'We need more capacity.' });
  });

  it('sets success on a successful submission', async () => {
    mockedRequestUpgrade.mockResolvedValue(response);
    const { result } = renderHook(() => useRequestUpgrade());

    await act(async () => {
      await result.current.submit(undefined);
    });

    expect(result.current.success).toEqual(response);
    expect(result.current.error).toBeUndefined();
  });

  it('sets error on failure, without ever setting success', async () => {
    mockedRequestUpgrade.mockRejectedValue(new Error('Service unavailable'));
    const { result } = renderHook(() => useRequestUpgrade());

    await act(async () => {
      await result.current.submit(undefined);
    });

    expect(result.current.error?.message).toBe('Service unavailable');
    expect(result.current.success).toBeUndefined();
  });

  it('reflects submitting: true while the request is in flight', async () => {
    let resolveRequest: (value: RequestUpgradeResponse) => void = () => {};
    mockedRequestUpgrade.mockReturnValue(new Promise((resolve) => (resolveRequest = resolve)));
    const { result } = renderHook(() => useRequestUpgrade());

    let submitPromise!: Promise<void>;
    act(() => {
      submitPromise = result.current.submit(undefined);
    });
    expect(result.current.submitting).toBe(true);

    await act(async () => {
      resolveRequest(response);
      await submitPromise;
    });
    expect(result.current.submitting).toBe(false);
  });

  it('prevents a duplicate submission while one is already in flight', async () => {
    let resolveRequest: (value: RequestUpgradeResponse) => void = () => {};
    mockedRequestUpgrade.mockReturnValue(new Promise((resolve) => (resolveRequest = resolve)));
    const { result } = renderHook(() => useRequestUpgrade());

    act(() => {
      void result.current.submit(undefined);
    });
    expect(result.current.submitting).toBe(true);

    // A second call while the first is still in flight must not fire a
    // second request.
    await act(async () => {
      await result.current.submit(undefined);
    });
    expect(mockedRequestUpgrade).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest(response);
    });
  });

  it('reset() clears success and error', async () => {
    mockedRequestUpgrade.mockResolvedValue(response);
    const { result } = renderHook(() => useRequestUpgrade());

    await act(async () => {
      await result.current.submit(undefined);
    });
    expect(result.current.success).toBeDefined();

    act(() => result.current.reset());

    expect(result.current.success).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });
});
