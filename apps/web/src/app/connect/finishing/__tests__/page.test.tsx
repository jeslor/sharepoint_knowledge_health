import { render, screen, waitFor } from '@testing-library/react';
import type { ConsentResolution } from '@sph/types';
import ConnectFinishingPage from '../page';
import { ApiError } from '@/lib/api/client';
import { isConnectFlowInProgress, startConnectFlow } from '@/lib/auth/connect-flow';

const mockReplace = jest.fn();
const mockUseIsAuthenticated = jest.fn();
let mockInProgress = 'none';
const mockGetAccessToken = jest.fn();
const mockPostConsentCallback = jest.fn();
const mockGetOnboardingStatus = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@azure/msal-react', () => ({
  useIsAuthenticated: () => mockUseIsAuthenticated(),
  useMsal: () => ({ inProgress: mockInProgress }),
}));

jest.mock('@/lib/auth/use-access-token', () => ({
  useAccessToken: () => mockGetAccessToken,
}));

jest.mock('@/lib/api/endpoints', () => ({
  postConsentCallback: (idToken: string, tenantName: string) => mockPostConsentCallback(idToken, tenantName),
  getOnboardingStatus: (organizationId: string, idToken: string) => mockGetOnboardingStatus(organizationId, idToken),
}));

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
    mockUseIsAuthenticated.mockReturnValue(true);
    mockGetAccessToken.mockResolvedValue('id-token-123');
    mockGetOnboardingStatus.mockResolvedValue(onboardingStatus('Completed'));
    sessionStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not call postConsentCallback and falls back to /dashboard when no connect flow was ever started', async () => {
    render(<ConnectFinishingPage />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    expect(mockPostConsentCallback).not.toHaveBeenCalled();
  });

  it('does not call postConsentCallback while MSAL interaction is still in progress, even with a pending flow', async () => {
    startConnectFlow('Acme Corporation');
    mockInProgress = 'startup';
    render(<ConnectFinishingPage />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockPostConsentCallback).not.toHaveBeenCalled();
  });

  it('obtains the token via useAccessToken and posts it with the stored tenant name once settled', async () => {
    startConnectFlow('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));

    render(<ConnectFinishingPage />);

    await waitFor(() => expect(mockPostConsentCallback).toHaveBeenCalledWith('id-token-123', 'Acme Corporation'));
    expect(mockGetAccessToken).toHaveBeenCalledTimes(1);
  });

  it('routes to /dashboard and clears the connect-flow marker on kind: existing (no discovery polling — not a fresh consent transition)', async () => {
    startConnectFlow('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('existing'));

    render(<ConnectFinishingPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    expect(isConnectFlowInProgress()).toBe(false);
    expect(mockGetOnboardingStatus).not.toHaveBeenCalled();
  });

  it('polls onboarding-status on kind: bootstrapped (ADR-0017 — purely reactive to backend-reported discoveryStatus) and routes to /dashboard once Completed', async () => {
    startConnectFlow('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));
    mockGetOnboardingStatus.mockResolvedValue(onboardingStatus('Completed'));

    render(<ConnectFinishingPage />);

    await waitFor(() => expect(mockGetOnboardingStatus).toHaveBeenCalledWith('org-1', 'id-token-123'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    expect(isConnectFlowInProgress()).toBe(false);
  });

  it('routes to /dashboard once discoveryStatus reports Failed (does not wait forever, does not block onboarding on a failed discovery)', async () => {
    startConnectFlow('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));
    mockGetOnboardingStatus.mockResolvedValue(onboardingStatus('Failed'));

    render(<ConnectFinishingPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    expect(mockGetOnboardingStatus).toHaveBeenCalledTimes(1);
  });

  it('renders "Discovering your SharePoint sites…" while discoveryStatus is Running — rendering backend state directly, no separate progress model', async () => {
    startConnectFlow('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));
    mockGetOnboardingStatus.mockResolvedValue(onboardingStatus('Running'));

    render(<ConnectFinishingPage />);

    expect(await screen.findByText('Discovering your SharePoint sites…')).toBeInTheDocument();
  });

  it('still routes to /dashboard on kind: bootstrapped even when reading onboarding-status fails (best-effort — the dashboard/Sites page remain the source of truth)', async () => {
    startConnectFlow('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));
    mockGetOnboardingStatus.mockRejectedValue(new Error('Network error'));

    render(<ConnectFinishingPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
  });

  it('gives up after a bounded number of polls and routes to /dashboard anyway when discovery never leaves Queued/Running', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    startConnectFlow('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));
    mockGetOnboardingStatus.mockResolvedValue(onboardingStatus('Queued'));

    render(<ConnectFinishingPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'), { timeout: 30_000 });
    // 10 bounded attempts (DISCOVERY_POLL_MAX_ATTEMPTS) — never unbounded.
    expect(mockGetOnboardingStatus).toHaveBeenCalledTimes(10);
  }, 35_000);

  it('renders a pending-approval message and clears the marker on kind: provisioned-pending', async () => {
    startConnectFlow('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('provisioned-pending'));

    render(<ConnectFinishingPage />);

    expect(await screen.findByText('Almost there')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(isConnectFlowInProgress()).toBe(false);
  });

  it('renders a not-connected message and clears the marker on kind: rejected', async () => {
    startConnectFlow('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('rejected'));

    render(<ConnectFinishingPage />);

    expect(await screen.findByText(/hasn.t completed admin consent/i)).toBeInTheDocument();
    expect(isConnectFlowInProgress()).toBe(false);
  });

  it('renders the server-provided message and clears the marker on an unexpected ApiError', async () => {
    startConnectFlow('Acme Corporation');
    mockPostConsentCallback.mockRejectedValue(new ApiError(500, 'Internal server error'));

    render(<ConnectFinishingPage />);

    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(isConnectFlowInProgress()).toBe(false);
  });

  it('renders a generic message and clears the marker for a non-ApiError failure', async () => {
    startConnectFlow('Acme Corporation');
    mockGetAccessToken.mockRejectedValue(new Error('network down'));

    render(<ConnectFinishingPage />);

    expect(await screen.findByText(/something went wrong while connecting your organization/i)).toBeInTheDocument();
    expect(isConnectFlowInProgress()).toBe(false);
  });

  it('provides a "Try again" link back to /connect on the rejected branch', async () => {
    startConnectFlow('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('rejected'));

    render(<ConnectFinishingPage />);

    const link = await screen.findByRole('link', { name: /try again/i });
    expect(link).toHaveAttribute('href', '/connect');
  });
});
