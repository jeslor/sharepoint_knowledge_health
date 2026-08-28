import { renderHook, act } from '@testing-library/react';
import type { OwnershipCoverageResponse } from '@sph/types';
import { useOwnershipCoverage } from '../use-ownership-coverage';
import { getOwnershipCoverage } from '../../endpoints';

jest.mock('../../endpoints');
jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => ({ user: { organizationId: 'org-1' } }),
}));
jest.mock('@/lib/auth/use-access-token', () => ({
  useAccessToken: () => async () => 'token-123',
}));

const mockedGetOwnershipCoverage = getOwnershipCoverage as jest.MockedFunction<typeof getOwnershipCoverage>;

const response: OwnershipCoverageResponse = {
  organizationWide: {
    covered: 5,
    noIdentifiableOwner: 1,
    allOwnersInactive: 1,
    notYetScored: 0,
    totalDocuments: 7,
    scoredDocuments: 7,
    coveragePercentage: 71,
  },
  bySite: [],
  ownerSourceBreakdown: { graphMetadataCount: 4, manualAssignmentCount: 3 },
  identityBreakdown: { activeRegisteredCount: 2, deactivatedRegisteredCount: 1, externalOrUnregisteredCount: 4 },
  calculatedAt: '2026-08-28T00:00:00.000Z',
};

describe('useOwnershipCoverage (ADR-0024 Phase A)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches with the organization id and token', async () => {
    mockedGetOwnershipCoverage.mockResolvedValue(response);
    renderHook(() => useOwnershipCoverage());

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedGetOwnershipCoverage).toHaveBeenCalledWith('org-1', 'token-123');
  });

  it('returns the response as-is', async () => {
    mockedGetOwnershipCoverage.mockResolvedValue(response);
    const { result } = renderHook(() => useOwnershipCoverage());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.data).toEqual(response);
  });

  it('surfaces an error on failure', async () => {
    mockedGetOwnershipCoverage.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useOwnershipCoverage());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.error?.message).toBe('Network error');
  });
});
