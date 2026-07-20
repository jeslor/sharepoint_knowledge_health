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
const mockDiscoverSharePointSites = jest.fn();

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
  discoverSharePointSites: (organizationId: string, idToken: string) => mockDiscoverSharePointSites(organizationId, idToken),
}));

function resolution(kind: ConsentResolution['kind']): ConsentResolution {
  if (kind === 'rejected') return { kind, reason: 'tenant-not-consented' };
  return { kind, organizationId: 'org-1', microsoftTenantId: 'tenant-1', userId: 'user-1' };
}

describe('ConnectFinishingPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInProgress = 'none';
    mockUseIsAuthenticated.mockReturnValue(true);
    mockGetAccessToken.mockResolvedValue('id-token-123');
    mockDiscoverSharePointSites.mockResolvedValue([]);
    sessionStorage.clear();
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

  it.each(['bootstrapped', 'existing'] as const)(
    'routes to /dashboard and clears the connect-flow marker on kind: %s',
    async (kind) => {
      startConnectFlow('Acme Corporation');
      mockPostConsentCallback.mockResolvedValue(resolution(kind));

      render(<ConnectFinishingPage />);

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
      expect(isConnectFlowInProgress()).toBe(false);
    },
  );

  it('auto-triggers site discovery on kind: bootstrapped (ADR-0014 §1 — the MicrosoftTenant just transitioned to Consented)', async () => {
    startConnectFlow('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));

    render(<ConnectFinishingPage />);

    await waitFor(() => expect(mockDiscoverSharePointSites).toHaveBeenCalledWith('org-1', 'id-token-123'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
  });

  it('does not trigger site discovery on kind: existing (a returning user, not a fresh consent transition)', async () => {
    startConnectFlow('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('existing'));

    render(<ConnectFinishingPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    expect(mockDiscoverSharePointSites).not.toHaveBeenCalled();
  });

  it('still routes to /dashboard on kind: bootstrapped even when site discovery fails (best-effort, manual "Discover sites" remains as a fallback)', async () => {
    startConnectFlow('Acme Corporation');
    mockPostConsentCallback.mockResolvedValue(resolution('bootstrapped'));
    mockDiscoverSharePointSites.mockRejectedValue(new Error('Graph temporarily unavailable'));

    render(<ConnectFinishingPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
  });

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
