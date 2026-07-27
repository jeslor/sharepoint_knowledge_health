import { renderHook, waitFor, act } from '@testing-library/react';
import type { SharePointSiteResponse } from '@sph/types';
import { useSharePointSiteManagement } from '../use-sharepoint-site-management';
import { approveSharePointSite, listSharePointSites, revokeSharePointSite } from '../../endpoints';

jest.mock('../../endpoints');
jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => ({ user: { organizationId: 'org-1' } }),
}));
jest.mock('@/lib/auth/use-access-token', () => ({
  useAccessToken: () => async () => 'token-123',
}));

const mockedListSharePointSites = listSharePointSites as jest.MockedFunction<typeof listSharePointSites>;
const mockedApproveSharePointSite = approveSharePointSite as jest.MockedFunction<typeof approveSharePointSite>;
const mockedRevokeSharePointSite = revokeSharePointSite as jest.MockedFunction<typeof revokeSharePointSite>;

function site(overrides: Partial<SharePointSiteResponse> = {}): SharePointSiteResponse {
  return {
    id: 'site-1',
    organizationId: 'org-1',
    microsoftTenantId: 'tenant-1',
    graphSiteId: 'graph-site-1',
    siteUrl: 'https://contoso.sharepoint.com/sites/team',
    displayName: 'Team Site',
    status: 'Discovered',
    approvedAt: null,
    approvedByUserId: null,
    lastScannedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

// Root cause regression tests (2026-07-25): approve/revoke used to wait on
// the full round trip (mutation + refetch) before the UI reflected the new
// status at all — the button visibly changed only once a background
// refetch resolved. Optimistic updates make the status change instant.
describe('useSharePointSiteManagement — optimistic approve/revoke', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reflects Approved immediately on approve(), before the network call resolves', async () => {
    mockedListSharePointSites.mockResolvedValue([site()]);
    let resolveApprove!: (value: SharePointSiteResponse) => void;
    mockedApproveSharePointSite.mockReturnValue(new Promise((resolve) => (resolveApprove = resolve)));

    const { result } = renderHook(() => useSharePointSiteManagement());
    await waitFor(() => expect(result.current.sites).toHaveLength(1));

    act(() => {
      void result.current.approve('site-1');
    });

    // Still in flight — status already reflects the optimistic value.
    expect(result.current.sites?.[0]?.status).toBe('Approved');

    await act(async () => {
      resolveApprove(site({ status: 'Approved' }));
      await Promise.resolve();
    });

    expect(result.current.sites?.[0]?.status).toBe('Approved');
  });

  it('reflects Removed immediately on revoke(), before the network call resolves', async () => {
    mockedListSharePointSites.mockResolvedValue([site({ status: 'Approved' })]);
    let resolveRevoke!: (value: SharePointSiteResponse) => void;
    mockedRevokeSharePointSite.mockReturnValue(new Promise((resolve) => (resolveRevoke = resolve)));

    const { result } = renderHook(() => useSharePointSiteManagement());
    await waitFor(() => expect(result.current.sites).toHaveLength(1));

    act(() => {
      void result.current.revoke('site-1');
    });

    expect(result.current.sites?.[0]?.status).toBe('Removed');

    await act(async () => {
      resolveRevoke(site({ status: 'Removed' }));
      await Promise.resolve();
    });

    expect(result.current.sites?.[0]?.status).toBe('Removed');
  });

  it('rolls back to the original status when approve() fails', async () => {
    mockedListSharePointSites.mockResolvedValue([site()]);
    mockedApproveSharePointSite.mockRejectedValue(new Error('Server rejected the request'));

    const { result } = renderHook(() => useSharePointSiteManagement());
    await waitFor(() => expect(result.current.sites).toHaveLength(1));

    await act(async () => {
      await result.current.approve('site-1');
    });

    expect(result.current.sites?.[0]?.status).toBe('Discovered');
    expect(result.current.mutateError?.message).toBe('Server rejected the request');
  });

  it('rolls back to the original status when revoke() fails', async () => {
    mockedListSharePointSites.mockResolvedValue([site({ status: 'Approved' })]);
    mockedRevokeSharePointSite.mockRejectedValue(new Error('Server rejected the request'));

    const { result } = renderHook(() => useSharePointSiteManagement());
    await waitFor(() => expect(result.current.sites).toHaveLength(1));

    await act(async () => {
      await result.current.revoke('site-1');
    });

    expect(result.current.sites?.[0]?.status).toBe('Approved');
    expect(result.current.mutateError?.message).toBe('Server rejected the request');
  });

  it('reconciles to the server value once the post-approval refetch resolves', async () => {
    mockedListSharePointSites
      .mockResolvedValueOnce([site()])
      .mockResolvedValueOnce([site({ status: 'Approved', approvedByUserId: 'admin-1' })]);
    mockedApproveSharePointSite.mockResolvedValue(site({ status: 'Approved' }));

    const { result } = renderHook(() => useSharePointSiteManagement());
    await waitFor(() => expect(result.current.sites).toHaveLength(1));

    await act(async () => {
      await result.current.approve('site-1');
    });

    // The refetch triggered by approve() resolves with the authoritative
    // server row — including fields the optimistic override never touched.
    await waitFor(() => expect(result.current.sites?.[0]?.approvedByUserId).toBe('admin-1'));
    expect(result.current.sites?.[0]?.status).toBe('Approved');
  });
});
