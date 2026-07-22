import { render, screen, waitFor } from '@testing-library/react';
import type { ConsentResolution, MeResponse } from '@sph/types';
import ConnectFinishingPage from '../page';
import { ApiError } from '@/lib/api/client';

const mockReplace = jest.fn();
const mockUseIsAuthenticated = jest.fn();
let mockInProgress = 'none';
let mockSearchParams = new URLSearchParams();
const mockGetAccessToken = jest.fn();
const mockPostConsentCallback = jest.fn();
const mockGetOnboardingStatus = jest.fn();
const mockRefetchCurrentUser = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock('@azure/msal-react', () => ({
  useIsAuthenticated: () => mockUseIsAuthenticated(),
  useMsal: () => ({ inProgress: mockInProgress }),
}));

jest.mock('@/lib/auth/use-access-token', () => ({
  useAccessToken: () => mockGetAccessToken,
}));

jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => ({ refetch: mockRefetchCurrentUser }),
}));

jest.mock('@/lib/api/endpoints', () => ({
  postConsentCallback: (idToken: string, tenantName: string) => mockPostConsentCallback(idToken, tenantName),
  getOnboardingStatus: (organizationId: string, idToken: string) => mockGetOnboardingStatus(organizationId, idToken),
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

function withTenantName(tenantName: string): void {
  mockSearchParams = new URLSearchParams({ tenantName });
}

function resolution(kind: ConsentResolution['kind']): ConsentResolution {
  if (kind === 'rejected') return { kind, reason: 'tenant-not-consented' };
  return { kind, organizationId: 'org-1', microsoftTenantId: 'tenant-1', userId: 'user-1' };
}

function onboardingStatus(discoveryStatus: 'NotStarted' | 'Queued' | 'Running' | 'Completed' | 'Failed' | null) {
  return {
    microsoftTenantStatus: 'Consented',
    discoveryStatus,
    discoveryStartedAt: null,
    discoveryCompletedAt: null,
    discoveryError: null,
  };
}

describe('ConnectFinishingPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInProgress = 'none';
    mockSearchParams = new URLSearchParams();
    mockUseIsAuthenticated.mockReturnValue(true);
    mockGetAccessToken.mockResolvedValue('id-token-123');
    mockGetOnboardingStatus.mockResolvedValue(onboardingStatus('Completed'));
    mockRefetchCurrentUser.mockResolvedValue(meResponse());
    sessionStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not call postConsentCallback and falls back to /dashboard when no tenantName query param is present', async () => {
    render(<ConnectFinishingPage />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    expect(mockPostConsentCallback).not.toHaveBeenCalled();
  });

  it('does not call postConsentCallback while MSAL interaction is still in progress, even with tenantName present', async () => {
    withTenantName('Acme Corporation');
    mockInProgress = 'startup';
    render(<ConnectFinishingPage />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockPostConsentCallback).not.toHaveBeenCalled();
  });

  // Root cause regression test (2026-07-22): the tenant name used to be
  // read back out of sessionStorage here, expected to have survived the
  // MSAL sign-in redirect round trip — live testing showed that hop losing
  // the value intermittently. It's now read from the query string instead,
  // populated by app/page.tsx from MSAL's own `state` parameter.
  it('obtains the token via useAccessToken and posts it with the tenantName query param once settled', async () => {
    withTenantName('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));

    render(<ConnectFinishingPage />);

    await waitFor(() => expect(mockPostConsentCallback).toHaveBeenCalledWith('id-token-123', 'Acme Corporation'));
    expect(mockGetAccessToken).toHaveBeenCalledTimes(1);
  });

  it('routes to /dashboard on kind: existing (no discovery polling — not a fresh consent transition)', async () => {
    withTenantName('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('existing'));

    render(<ConnectFinishingPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    expect(mockGetOnboardingStatus).not.toHaveBeenCalled();
  });

  it('polls onboarding-status on kind: bootstrapped (ADR-0017 — purely reactive to backend-reported discoveryStatus) and routes to /dashboard once Completed', async () => {
    withTenantName('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));
    mockGetOnboardingStatus.mockResolvedValue(onboardingStatus('Completed'));

    render(<ConnectFinishingPage />);

    await waitFor(() => expect(mockGetOnboardingStatus).toHaveBeenCalledWith('org-1', 'id-token-123'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
  });

  it('routes to /dashboard once discoveryStatus reports Failed (does not wait forever, does not block onboarding on a failed discovery)', async () => {
    withTenantName('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));
    mockGetOnboardingStatus.mockResolvedValue(onboardingStatus('Failed'));

    render(<ConnectFinishingPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    expect(mockGetOnboardingStatus).toHaveBeenCalledTimes(1);
  });

  it('renders "Discovering your SharePoint sites…" while discoveryStatus is Running — rendering backend state directly, no separate progress model', async () => {
    withTenantName('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));
    mockGetOnboardingStatus.mockResolvedValue(onboardingStatus('Running'));

    render(<ConnectFinishingPage />);

    expect(await screen.findByText('Discovering your SharePoint sites…')).toBeInTheDocument();
  });

  it('still routes to /dashboard on kind: bootstrapped even when reading onboarding-status fails (best-effort — the dashboard/Sites page remain the source of truth)', async () => {
    withTenantName('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));
    mockGetOnboardingStatus.mockRejectedValue(new Error('Network error'));

    render(<ConnectFinishingPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
  });

  it('gives up after a bounded number of polls and routes to /dashboard anyway when discovery never leaves Queued/Running', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    withTenantName('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));
    mockGetOnboardingStatus.mockResolvedValue(onboardingStatus('Queued'));

    render(<ConnectFinishingPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'), { timeout: 30_000 });
    // 10 bounded attempts (DISCOVERY_POLL_MAX_ATTEMPTS) — never unbounded.
    expect(mockGetOnboardingStatus).toHaveBeenCalledTimes(10);
  }, 35_000);

  it('renders a pending-approval message on kind: provisioned-pending', async () => {
    withTenantName('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('provisioned-pending'));

    render(<ConnectFinishingPage />);

    expect(await screen.findByText('Almost there')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('renders a not-connected message on kind: rejected', async () => {
    withTenantName('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('rejected'));

    render(<ConnectFinishingPage />);

    expect(await screen.findByText(/hasn.t completed admin consent/i)).toBeInTheDocument();
  });

  it('renders the server-provided message on an unexpected ApiError', async () => {
    withTenantName('Acme Corporation');
    mockPostConsentCallback.mockRejectedValue(new ApiError(500, 'Internal server error'));

    render(<ConnectFinishingPage />);

    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders a generic message for a non-ApiError failure', async () => {
    withTenantName('Acme Corporation');
    mockGetAccessToken.mockRejectedValue(new Error('network down'));

    render(<ConnectFinishingPage />);

    expect(await screen.findByText(/something went wrong while connecting your organization/i)).toBeInTheDocument();
  });

  it('provides a "Try again" link back to /connect on the rejected branch', async () => {
    withTenantName('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('rejected'));

    render(<ConnectFinishingPage />);

    const link = await screen.findByRole('link', { name: /try again/i });
    expect(link).toHaveAttribute('href', '/connect');
  });

  // Root cause regression tests (2026-07-22): CurrentUserProvider's own GET
  // /auth/me is dispatched the instant isAuthenticated flips true, on "/" —
  // necessarily before this page even mounts, let alone before
  // POST /auth/consent-callback bootstraps an Organization. That first,
  // necessarily-403 result used to sit uninvalidated for the rest of the
  // session, so AuthGate on /dashboard read it and bounced a
  // successfully-onboarded user straight back to /connect. These tests prove
  // the fix: /dashboard is only ever reached after refetchCurrentUser()
  // itself resolves successfully.
  describe('deterministic post-provisioning refetch (root cause fix)', () => {
    it('awaits refetchCurrentUser() and only navigates to /dashboard once it resolves, on kind: bootstrapped', async () => {
      withTenantName('Acme Corporation');
      mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));
      let resolveRefetch!: (user: MeResponse) => void;
      mockRefetchCurrentUser.mockReturnValue(new Promise<MeResponse>((resolve) => (resolveRefetch = resolve)));

      render(<ConnectFinishingPage />);

      await waitFor(() => expect(mockRefetchCurrentUser).toHaveBeenCalledTimes(1));
      // The refetch promise is still pending — navigation must not have
      // happened yet, proving this isn't a fire-and-forget call.
      expect(mockReplace).not.toHaveBeenCalled();

      resolveRefetch(meResponse());
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    });

    it('does not navigate to /dashboard when refetchCurrentUser rejects, even though provisioning already succeeded', async () => {
      withTenantName('Acme Corporation');
      mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));
      mockRefetchCurrentUser.mockRejectedValue(new Error('network down'));

      render(<ConnectFinishingPage />);

      expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalledWith('/dashboard');
    });

    it('rejects (and does not navigate) if the refetched user has no organizationId, even on a 200 response', async () => {
      withTenantName('Acme Corporation');
      mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));
      mockRefetchCurrentUser.mockResolvedValue(meResponse({ organizationId: '' }));

      render(<ConnectFinishingPage />);

      expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalledWith('/dashboard');
    });

    it('applies the same await-refetch-before-navigating sequence on kind: existing (returning user, no provisioning needed)', async () => {
      withTenantName('Acme Corporation');
      mockPostConsentCallback.mockResolvedValue(resolution('existing'));
      let resolveRefetch!: (user: MeResponse) => void;
      mockRefetchCurrentUser.mockReturnValue(new Promise<MeResponse>((resolve) => (resolveRefetch = resolve)));

      render(<ConnectFinishingPage />);

      await waitFor(() => expect(mockRefetchCurrentUser).toHaveBeenCalledTimes(1));
      expect(mockReplace).not.toHaveBeenCalled();

      resolveRefetch(meResponse());
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    });

    it('never calls refetchCurrentUser for kind: provisioned-pending or kind: rejected (no dashboard destination to reach)', async () => {
      withTenantName('Acme Corporation');
      mockPostConsentCallback.mockResolvedValue(resolution('provisioned-pending'));

      render(<ConnectFinishingPage />);

      await screen.findByText('Almost there');
      expect(mockRefetchCurrentUser).not.toHaveBeenCalled();
    });
  });
});
