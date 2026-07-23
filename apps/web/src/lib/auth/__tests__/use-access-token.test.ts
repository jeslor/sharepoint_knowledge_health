import { renderHook } from '@testing-library/react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { useAccessToken } from '../use-access-token';

const mockAcquireTokenSilent = jest.fn();
const mockAcquireTokenRedirect = jest.fn();
const mockGetActiveAccount = jest.fn();
let mockAccounts: Array<{ homeAccountId: string }> = [];

jest.mock('@azure/msal-react', () => ({
  useMsal: () => ({
    instance: {
      acquireTokenSilent: mockAcquireTokenSilent,
      acquireTokenRedirect: mockAcquireTokenRedirect,
      getActiveAccount: mockGetActiveAccount,
    },
    accounts: mockAccounts,
  }),
}));

const staleAccount = { homeAccountId: 'stale-account' };
const activeAccount = { homeAccountId: 'freshly-signed-in-account' };

describe('useAccessToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccounts = [];
    mockGetActiveAccount.mockReturnValue(null);
  });

  // Root cause regression test (2026-07-22): accounts[0] is an arbitrary
  // entry in MSAL's cached-accounts array, not necessarily the account that
  // just completed a fresh interactive login. Once more than one account
  // has ever been cached in a browser (trivially true after repeated
  // onboarding attempts), accounts[0] can silently resolve to a stale,
  // already-expired account, and acquireTokenSilent happily returns that
  // stale account's unchanged cached ID token instead of erroring.
  // msalInstance's own event callback already keeps getActiveAccount() in
  // sync with the account that just signed in — that must be what's used.
  it('acquires a token for the active account, not accounts[0], when the two differ', async () => {
    mockAccounts = [staleAccount, activeAccount];
    mockGetActiveAccount.mockReturnValue(activeAccount);
    mockAcquireTokenSilent.mockResolvedValue({ idToken: 'fresh-id-token' });

    const { result } = renderHook(() => useAccessToken());
    const token = await result.current();

    expect(token).toBe('fresh-id-token');
    expect(mockAcquireTokenSilent).toHaveBeenCalledWith(expect.objectContaining({ account: activeAccount }));
  });

  it('falls back to accounts[0] when no account is active yet', async () => {
    mockAccounts = [staleAccount];
    mockGetActiveAccount.mockReturnValue(null);
    mockAcquireTokenSilent.mockResolvedValue({ idToken: 'token-for-only-account' });

    const { result } = renderHook(() => useAccessToken());
    const token = await result.current();

    expect(token).toBe('token-for-only-account');
    expect(mockAcquireTokenSilent).toHaveBeenCalledWith(expect.objectContaining({ account: staleAccount }));
  });

  it('throws when there is no active account and no cached account at all', async () => {
    mockAccounts = [];
    mockGetActiveAccount.mockReturnValue(null);

    const { result } = renderHook(() => useAccessToken());

    await expect(result.current()).rejects.toThrow('No authenticated account — sign in first');
    expect(mockAcquireTokenSilent).not.toHaveBeenCalled();
  });

  it('falls back to an interactive redirect when silent acquisition requires interaction', async () => {
    mockAccounts = [activeAccount];
    mockGetActiveAccount.mockReturnValue(activeAccount);
    const interactionError = new InteractionRequiredAuthError('interaction_required', 'test');
    mockAcquireTokenSilent.mockRejectedValue(interactionError);
    mockAcquireTokenRedirect.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAccessToken());

    await expect(result.current()).rejects.toBe(interactionError);
    expect(mockAcquireTokenRedirect).toHaveBeenCalledWith(expect.objectContaining({ account: activeAccount }));
  });
});
