import { renderHook, act } from '@testing-library/react';
import { useConfirmReviewDateMapping } from '../use-confirm-review-date-mapping';
import { confirmReviewDateMapping } from '../../endpoints';

jest.mock('../../endpoints');
jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => ({ user: { organizationId: 'org-1' } }),
}));
jest.mock('@/lib/auth/use-access-token', () => ({
  useAccessToken: () => async () => 'token-123',
}));

const mockedConfirmReviewDateMapping = confirmReviewDateMapping as jest.MockedFunction<typeof confirmReviewDateMapping>;

const mappingResponse = {
  id: 'mapping-1',
  siteId: 'site-1',
  graphListId: 'list-1',
  columnDefinitionId: 'col-1',
  columnDisplayName: 'Review Date',
  status: 'Active',
  confirmedByUserId: 'user-1',
  confirmedByDisplayName: 'Alice Admin',
  confirmedAt: '2026-08-12T00:00:00.000Z',
};

describe('useConfirmReviewDateMapping', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls confirmReviewDateMapping without a columnDefinitionId for the single-candidate case', async () => {
    mockedConfirmReviewDateMapping.mockResolvedValue(mappingResponse);
    const { result } = renderHook(() => useConfirmReviewDateMapping());

    await act(async () => {
      await result.current.confirm('site-1', 'list-1');
    });

    expect(mockedConfirmReviewDateMapping).toHaveBeenCalledWith(
      'org-1',
      'site-1',
      { graphListId: 'list-1', columnDefinitionId: undefined },
      'token-123',
    );
  });

  it('passes an explicit columnDefinitionId for the multiple-candidates case', async () => {
    mockedConfirmReviewDateMapping.mockResolvedValue(mappingResponse);
    const { result } = renderHook(() => useConfirmReviewDateMapping());

    await act(async () => {
      await result.current.confirm('site-1', 'list-1', 'col-2');
    });

    expect(mockedConfirmReviewDateMapping).toHaveBeenCalledWith(
      'org-1',
      'site-1',
      { graphListId: 'list-1', columnDefinitionId: 'col-2' },
      'token-123',
    );
  });

  it('returns the confirmed mapping on success', async () => {
    mockedConfirmReviewDateMapping.mockResolvedValue(mappingResponse);
    const { result } = renderHook(() => useConfirmReviewDateMapping());

    let returned;
    await act(async () => {
      returned = await result.current.confirm('site-1', 'list-1');
    });

    expect(returned).toEqual(mappingResponse);
  });

  it('surfaces an error and returns undefined on failure — the caller must not assume success', async () => {
    mockedConfirmReviewDateMapping.mockRejectedValue(new Error('Multiple candidate date columns were found'));
    const { result } = renderHook(() => useConfirmReviewDateMapping());

    let returned;
    await act(async () => {
      returned = await result.current.confirm('site-1', 'list-1');
    });

    expect(returned).toBeUndefined();
    expect(result.current.confirmError?.message).toBe('Multiple candidate date columns were found');
  });

  it('sets confirming true only while the request is in flight', async () => {
    let resolveConfirm!: (value: typeof mappingResponse) => void;
    mockedConfirmReviewDateMapping.mockReturnValue(new Promise((resolve) => (resolveConfirm = resolve)));
    const { result } = renderHook(() => useConfirmReviewDateMapping());

    let confirmPromise!: Promise<unknown>;
    act(() => {
      confirmPromise = result.current.confirm('site-1', 'list-1');
    });
    expect(result.current.confirming).toBe(true);

    await act(async () => {
      resolveConfirm(mappingResponse);
      await confirmPromise;
    });
    expect(result.current.confirming).toBe(false);
  });
});
