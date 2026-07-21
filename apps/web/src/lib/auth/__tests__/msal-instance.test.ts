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
  EventType: { LOGIN_SUCCESS: 'msal:loginSuccess' },
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
  } {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../msal-instance') as typeof import('../msal-instance');
    const [registeredCallback] = mockAddEventCallback.mock.calls[0] as [(event: unknown) => void];
    return {
      consumeLastLoginState: mod.consumeLastLoginState,
      fireLoginSuccess: (payload) => registeredCallback({ eventType: 'msal:loginSuccess', payload }),
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
});
