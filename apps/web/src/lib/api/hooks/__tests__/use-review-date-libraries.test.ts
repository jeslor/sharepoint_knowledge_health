import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReviewDateLibraryResponse } from '@sph/types';
import { useReviewDateLibraries } from '../use-review-date-libraries';
import { listReviewDateLibraries } from '../../endpoints';

jest.mock('../../endpoints');
jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => ({ user: { organizationId: 'org-1' } }),
}));
jest.mock('@/lib/auth/use-access-token', () => ({
  useAccessToken: () => async () => 'token-123',
}));

const mockedListReviewDateLibraries = listReviewDateLibraries as jest.MockedFunction<typeof listReviewDateLibraries>;

function library(overrides: Partial<ReviewDateLibraryResponse> = {}): ReviewDateLibraryResponse {
  return { graphListId: 'list-1', driveId: 'drive-1', name: 'Documents', mapping: null, ...overrides };
}

describe('useReviewDateLibraries', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches libraries for the given site, scoped to the current organization', async () => {
    mockedListReviewDateLibraries.mockResolvedValue([library()]);

    const { result } = renderHook(() => useReviewDateLibraries('site-1'));

    await waitFor(() => expect(result.current.libraries).toHaveLength(1));
    expect(mockedListReviewDateLibraries).toHaveBeenCalledWith('org-1', 'site-1', 'token-123');
  });

  it('starts in a loading state before the first fetch resolves', () => {
    mockedListReviewDateLibraries.mockReturnValue(new Promise(() => undefined));

    const { result } = renderHook(() => useReviewDateLibraries('site-1'));

    expect(result.current.loading).toBe(true);
    expect(result.current.libraries).toBeUndefined();
  });

  it('surfaces a fetch error', async () => {
    mockedListReviewDateLibraries.mockRejectedValue(new Error('Site not found'));

    const { result } = renderHook(() => useReviewDateLibraries('site-1'));

    await waitFor(() => expect(result.current.error?.message).toBe('Site not found'));
  });

  it('refetch() re-invokes the endpoint', async () => {
    mockedListReviewDateLibraries.mockResolvedValue([library()]);
    const { result } = renderHook(() => useReviewDateLibraries('site-1'));
    await waitFor(() => expect(result.current.libraries).toHaveLength(1));

    mockedListReviewDateLibraries.mockResolvedValue([library(), library({ graphListId: 'list-2' })]);
    act(() => result.current.refetch());

    await waitFor(() => expect(result.current.libraries).toHaveLength(2));
  });
});
