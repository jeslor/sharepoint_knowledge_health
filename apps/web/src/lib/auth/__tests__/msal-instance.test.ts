const mockAddEventCallback = jest.fn();
const mockGetActiveAccount = jest.fn();
const mockGetAllAccounts = jest.fn();
const mockSetActiveAccount = jest.fn();

jest.mock('@azure/msal-browser', () => ({
  PublicClientApplication: jest.fn().mockImplementation(() => ({
    addEventCallback: mockAddEventCallback,
    getActiveAccount: mockGetActiveAccount,
    getAllAccounts: mockGetAllAccounts,
    setActiveAccount: mockSetActiveAccount,
  })),
  EventType: { LOGIN_SUCCESS: 'msal:loginSuccess', ACQUIRE_TOKEN_SUCCESS: 'msal:acquireTokenSuccess' },
  InteractionType: { Redirect: 'redirect', Popup: 'popup', Silent: 'silent' },
}));

jest.mock('../msal-config', () => ({
  msalConfig: { auth: { clientId: 'test-client-id', authority: 'https://login.microsoftonline.com/organizations' } },
}));

describe('msal-instance consumeLastLoginState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveAccount.mockReturnValue(null);
    mockGetAllAccounts.mockReturnValue([]);
    jest.resetModules();
  });

  function loadModuleAndGetEventCallback(): {
    consumeLastLoginState: () => string | null;
    fireLoginSuccess: (payload: { account?: unknown; state?: string }) => void;
    fireEvent: (eventType: string, interactionType: string | undefined, payload: { account?: unknown; state?: string }) => void;
  } {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../msal-instance') as typeof import('../msal-instance');
    const [registeredCallback] = mockAddEventCallback.mock.calls[0] as [(event: unknown) => void];
    return {
      consumeLastLoginState: mod.consumeLastLoginState,
      fireLoginSuccess: (payload) => registeredCallback({ eventType: 'msal:loginSuccess', interactionType: 'redirect', payload }),
      fireEvent: (eventType, interactionType, payload) => registeredCallback({ eventType, interactionType, payload }),
    };
  }

  // Root cause regression test (2026-07-22): the tenant name used to be
  // carried across the MSAL sign-in redirect via sessionStorage, which live
  // testing showed losing the value intermittently on that specific hop.
  // It's now carried through MSAL's own `state` parameter instead — this
  // verifies that value is captured off the LOGIN_SUCCESS event and can be
  // read back exactly once.
  it('captures state from a LOGIN_SUCCESS event and returns it from consumeLastLoginState', () => {
    const { consumeLastLoginState, fireLoginSuccess } = loadModuleAndGetEventCallback();

    fireLoginSuccess({ account: { homeAccountId: 'acc-1' }, state: JSON.stringify({ kind: 'connect', tenantName: 'Acme Corporation' }) });

    expect(consumeLastLoginState()).toBe(JSON.stringify({ kind: 'connect', tenantName: 'Acme Corporation' }));
  });

  it('consuming clears the value — a second read returns null', () => {
    const { consumeLastLoginState, fireLoginSuccess } = loadModuleAndGetEventCallback();
    fireLoginSuccess({ account: { homeAccountId: 'acc-1' }, state: 'some-state' });

    expect(consumeLastLoginState()).toBe('some-state');
    expect(consumeLastLoginState()).toBeNull();
  });

  it('returns null when no login has happened yet', () => {
    const { consumeLastLoginState } = loadModuleAndGetEventCallback();
    expect(consumeLastLoginState()).toBeNull();
  });

  // A plain returning-user sign-in (SignInButton) passes no custom state at
  // all — this must not be confused with a connect-flow login.
  it('returns null after a LOGIN_SUCCESS event with no state (a plain sign-in)', () => {
    const { consumeLastLoginState, fireLoginSuccess } = loadModuleAndGetEventCallback();
    fireLoginSuccess({ account: { homeAccountId: 'acc-1' } });

    expect(consumeLastLoginState()).toBeNull();
  });

  it('sets the active account from the LOGIN_SUCCESS payload', () => {
    const { fireLoginSuccess } = loadModuleAndGetEventCallback();
    const account = { homeAccountId: 'acc-1' };
    fireLoginSuccess({ account, state: 'x' });

    expect(mockSetActiveAccount).toHaveBeenCalledWith(account);
  });

  // Root cause regression test (2026-07-22): msal-browser's own
  // StandardController only emits LOGIN_SUCCESS if the number of cached
  // accounts increased as a result of this redirect. A browser that already
  // has this account cached from an earlier sign-in — any returning user
  // repeating the connect flow, not a rare edge case — gets
  // ACQUIRE_TOKEN_SUCCESS instead, with an identical payload shape. Live
  // testing found this: the state was silently dropped because the
  // original code only listened for LOGIN_SUCCESS, sending a real,
  // successfully-authenticated connect-flow user to /dashboard instead of
  // /connect/finishing.
  it('captures state from an ACQUIRE_TOKEN_SUCCESS redirect event just like LOGIN_SUCCESS (returning-account case)', () => {
    const { consumeLastLoginState, fireEvent } = loadModuleAndGetEventCallback();

    fireEvent('msal:acquireTokenSuccess', 'redirect', {
      account: { homeAccountId: 'acc-1' },
      state: JSON.stringify({ kind: 'connect', tenantName: 'Acme Corporation' }),
    });

    expect(consumeLastLoginState()).toBe(JSON.stringify({ kind: 'connect', tenantName: 'Acme Corporation' }));
  });

  // A silent, background token renewal (e.g. triggered by some unrelated
  // getAccessToken() call elsewhere in the app) also emits
  // ACQUIRE_TOKEN_SUCCESS, but carries no meaningful connect-flow state and
  // must not clobber a value still waiting to be consumed.
  it('ignores ACQUIRE_TOKEN_SUCCESS from a Silent interaction (background token renewal)', () => {
    const { consumeLastLoginState, fireLoginSuccess, fireEvent } = loadModuleAndGetEventCallback();

    fireLoginSuccess({ account: { homeAccountId: 'acc-1' }, state: JSON.stringify({ kind: 'connect', tenantName: 'Acme Corporation' }) });
    fireEvent('msal:acquireTokenSuccess', 'silent', { account: { homeAccountId: 'acc-1' }, state: '' });

    expect(consumeLastLoginState()).toBe(JSON.stringify({ kind: 'connect', tenantName: 'Acme Corporation' }));
  });
});
