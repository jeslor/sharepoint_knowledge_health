import { render, screen, waitFor, act } from '@testing-library/react';
import { CurrentUserProvider, useCurrentUser } from '../current-user-context';
import type { MeResponse } from '@sph/types';

const mockUseIsAuthenticated = jest.fn();
const mockGetAccessToken = jest.fn();
const mockGetMe = jest.fn();

jest.mock('@azure/msal-react', () => ({
  useIsAuthenticated: () => mockUseIsAuthenticated(),
}));

jest.mock('../use-access-token', () => ({
  useAccessToken: () => mockGetAccessToken,
}));

jest.mock('@/lib/api/endpoints', () => ({
  getMe: (token: string) => mockGetMe(token),
}));

function meResponse(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: 'user-1',
    role: 'Admin',
    organizationId: 'org-1',
    displayName: 'Admin',
    email: 'admin@example.com',
    tenantName: 'Acme Corporation',
    ...overrides,
  };
}

function Probe(): JSX.Element {
  const { user, error } = useCurrentUser();
  return (
    <div>
      <span data-testid="user">{user ? user.id : 'none'}</span>
      <span data-testid="error">{error ? error.message : 'none'}</span>
    </div>
  );
}

/** Exposes the live `refetch` function for a test to call and inspect directly (bypassing any onClick indirection). */
function Capture({ onReady }: { onReady: (refetch: () => Promise<MeResponse>) => void }): null {
  onReady(useCurrentUser().refetch);
  return null;
}

describe('CurrentUserProvider refetch — determinism (root cause fix)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseIsAuthenticated.mockReturnValue(true);
    mockGetAccessToken.mockResolvedValue('id-token-123');
  });

  it('refetch() returns a promise that resolves only once GET /auth/me actually completes, with the fetched user', async () => {
    mockGetMe.mockResolvedValueOnce(meResponse());
    let refetch: (() => Promise<MeResponse>) | undefined;

    render(
      <CurrentUserProvider>
        <Probe />
        <Capture onReady={(fn) => (refetch = fn)} />
      </CurrentUserProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('user-1'));

    let resolveGetMe!: (value: MeResponse) => void;
    mockGetMe.mockReturnValue(new Promise<MeResponse>((resolve) => (resolveGetMe = resolve)));

    let settled = false;
    const refetchPromise = refetch!().then((value) => {
      settled = true;
      return value;
    });

    // Still pending after a tick — proves this is a real awaited fetch, not
    // a fire-and-forget tick-bump that resolves regardless of network state.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    resolveGetMe(meResponse({ id: 'user-2' }));
    const result = await refetchPromise;
    expect(settled).toBe(true);
    expect(result.id).toBe('user-2');
  });

  it('refetch() rejects when GET /auth/me fails, and the caller can await/catch it directly', async () => {
    mockGetMe.mockResolvedValueOnce(meResponse());
    let refetch: (() => Promise<MeResponse>) | undefined;

    render(
      <CurrentUserProvider>
        <Capture onReady={(fn) => (refetch = fn)} />
      </CurrentUserProvider>,
    );
    await waitFor(() => expect(refetch).toBeDefined());

    mockGetMe.mockRejectedValueOnce(new Error('network down'));
    await expect(refetch!()).rejects.toThrow('network down');
  });

  it('updates context state (user/error) to match the refetch outcome, readable by every consumer', async () => {
    mockGetMe.mockResolvedValueOnce(meResponse());
    let refetch: (() => Promise<MeResponse>) | undefined;

    render(
      <CurrentUserProvider>
        <Probe />
        <Capture onReady={(fn) => (refetch = fn)} />
      </CurrentUserProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('user-1'));

    mockGetMe.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      await refetch!().catch(() => undefined);
    });

    expect(screen.getByTestId('error').textContent).toBe('boom');
  });

  // Root cause regression test (2026-07-22): the exact sequence that used to
  // break onboarding — the automatic fetch fires immediately on mount
  // (isAuthenticated already true) and 403s because provisioning hasn't
  // happened yet; a later, explicit refetch() (as /connect/finishing now
  // performs after a successful consent-callback resolution) must still
  // resolve with the now-valid user, and the caller awaiting it sees that
  // success, not the earlier failure.
  it('an initial 403 does not poison a later explicit refetch — the caller awaiting refetch() sees the post-provisioning success', async () => {
    mockGetMe.mockRejectedValueOnce(Object.assign(new Error('Organization not connected'), { status: 403 }));
    let refetch: (() => Promise<MeResponse>) | undefined;

    render(
      <CurrentUserProvider>
        <Probe />
        <Capture onReady={(fn) => (refetch = fn)} />
      </CurrentUserProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('Organization not connected'));

    mockGetMe.mockResolvedValueOnce(meResponse());
    const user = await refetch!();

    expect(user.organizationId).toBe('org-1');
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('none'));
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('user-1'));
  });
});
