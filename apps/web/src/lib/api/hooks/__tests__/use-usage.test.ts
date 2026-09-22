import { renderHook, act } from '@testing-library/react';
import type { UsageResponse } from '@sph/types';
import { useUsage } from '../use-usage';
import { getUsage } from '../../endpoints';

jest.mock('../../endpoints');
jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => ({ user: { organizationId: 'org-1' } }),
}));
jest.mock('@/lib/auth/use-access-token', () => ({
  useAccessToken: () => async () => 'token-123',
}));

const mockedGetUsage = getUsage as jest.MockedFunction<typeof getUsage>;

const response: UsageResponse = {
  planType: 'Trial',
  documentLimit: 2000,
  currentDocumentCount: 1847,
  remainingDocumentCount: 153,
  usagePercentage: 92.35,
  limitReached: false,
};

describe('useUsage (Phase 5)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches with the organization id and token', async () => {
    mockedGetUsage.mockResolvedValue(response);
    renderHook(() => useUsage());

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedGetUsage).toHaveBeenCalledWith('org-1', 'token-123');
  });

  it('returns the response as-is — never recomputes a conflicting usage state', async () => {
    mockedGetUsage.mockResolvedValue(response);
    const { result } = renderHook(() => useUsage());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.data).toEqual(response);
  });

  it('surfaces an error on failure', async () => {
    mockedGetUsage.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useUsage());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error?.message).toBe('Network error');
  });
});
