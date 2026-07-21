import { render, screen, fireEvent } from '@testing-library/react';
import ConnectPage from '../page';
import { ApiError } from '@/lib/api/client';

const mockReplace = jest.fn();
const mockUseIsAuthenticated = jest.fn();
const mockUseCurrentUser = jest.fn();
let mockInProgress = 'none';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@azure/msal-react', () => ({
  useIsAuthenticated: () => mockUseIsAuthenticated(),
  useMsal: () => ({ inProgress: mockInProgress }),
}));

jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

describe('ConnectPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInProgress = 'none';
    mockUseIsAuthenticated.mockReturnValue(false);
    mockUseCurrentUser.mockReturnValue({ user: undefined, loading: false, error: undefined });
    sessionStorage.clear();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, href: '' },
    });
  });

  it('keeps the Connect button disabled when the tenant name is empty', () => {
    render(<ConnectPage />);
    expect(screen.getByRole('button', { name: /connect microsoft 365/i })).toBeDisabled();
  });

  it('keeps the Connect button disabled for a whitespace-only tenant name', () => {
    render(<ConnectPage />);
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /connect microsoft 365/i })).toBeDisabled();
  });

  it('enables the Connect button once a valid tenant name is entered', () => {
    render(<ConnectPage />);
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Acme Corporation' } });
    expect(screen.getByRole('button', { name: /connect microsoft 365/i })).toBeEnabled();
  });

  it('clicking Connect stores state + tenant name and navigates to the Microsoft admin-consent URL', () => {
    render(<ConnectPage />);
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Acme Corporation' } });
    fireEvent.click(screen.getByRole('button', { name: /connect microsoft 365/i }));

    const storedState = sessionStorage.getItem('sph:connect:state');
    expect(storedState).toBeTruthy();
    expect(sessionStorage.getItem('sph:connect:tenantName')).toBe('Acme Corporation');

    expect(window.location.href).toContain('https://login.microsoftonline.com/organizations/adminconsent?');
    const navigatedUrl = new URL(window.location.href);
    expect(navigatedUrl.searchParams.get('client_id')).toBe('test-client-id');
    expect(navigatedUrl.searchParams.get('state')).toBe(storedState);
    expect(navigatedUrl.searchParams.get('redirect_uri')).toContain('/connect/admin-consent-callback');
  });

  it('trims the tenant name before storing it', () => {
    render(<ConnectPage />);
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: '  Acme Corporation  ' } });
    fireEvent.click(screen.getByRole('button', { name: /connect microsoft 365/i }));
    expect(sessionStorage.getItem('sph:connect:tenantName')).toBe('Acme Corporation');
  });

  it('redirects an already-connected visitor (GET /auth/me resolved) to /dashboard instead of showing the form', () => {
    mockUseIsAuthenticated.mockReturnValue(true);
    mockUseCurrentUser.mockReturnValue({ user: { organizationId: 'org-1' }, loading: false, error: undefined });
    render(<ConnectPage />);
    expect(mockReplace).toHaveBeenCalledWith('/dashboard');
  });

  it('redirects a pending-approval visitor to /dashboard (AuthGate renders the pending message there)', () => {
    mockUseIsAuthenticated.mockReturnValue(true);
    mockUseCurrentUser.mockReturnValue({
      user: undefined,
      loading: false,
      error: new ApiError(403, 'Account pending approval'),
    });
    render(<ConnectPage />);
    expect(mockReplace).toHaveBeenCalledWith('/dashboard');
  });

  // Root cause regression test (2026-07-21): before this fix, ConnectPage
  // redirected to /dashboard for any authenticated visitor regardless of
  // provisioning state, while AuthGate redirected this exact 403 back to
  // /connect — an infinite bounce loop for a signed-in-but-unprovisioned
  // identity. This is the case /connect exists to serve, so it must never
  // redirect away from itself here.
  it('does NOT redirect to /dashboard for an authenticated visitor with no Organization yet (would loop with AuthGate) — shows the connect form instead', async () => {
    mockUseIsAuthenticated.mockReturnValue(true);
    mockUseCurrentUser.mockReturnValue({
      user: undefined,
      loading: false,
      error: new ApiError(403, 'Organization not connected'),
    });
    render(<ConnectPage />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /connect microsoft 365/i })).toBeInTheDocument();
  });

  it('does not redirect while GET /auth/me is still loading, even though isAuthenticated is already true', async () => {
    mockUseIsAuthenticated.mockReturnValue(true);
    mockUseCurrentUser.mockReturnValue({ user: undefined, loading: true, error: undefined });
    render(<ConnectPage />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not redirect an authenticated visitor while MSAL is still processing a redirect response', () => {
    mockUseIsAuthenticated.mockReturnValue(true);
    mockUseCurrentUser.mockReturnValue({ user: { organizationId: 'org-1' }, loading: false, error: undefined });
    mockInProgress = 'startup';
    render(<ConnectPage />);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
