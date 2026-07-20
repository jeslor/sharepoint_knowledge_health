import { render, screen, fireEvent } from '@testing-library/react';
import ConnectPage from '../page';

const mockReplace = jest.fn();
const mockUseIsAuthenticated = jest.fn();
let mockInProgress = 'none';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@azure/msal-react', () => ({
  useIsAuthenticated: () => mockUseIsAuthenticated(),
  useMsal: () => ({ inProgress: mockInProgress }),
}));

describe('ConnectPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInProgress = 'none';
    mockUseIsAuthenticated.mockReturnValue(false);
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

  it('redirects an already-authenticated visitor to /dashboard instead of showing the form', () => {
    mockUseIsAuthenticated.mockReturnValue(true);
    render(<ConnectPage />);
    expect(mockReplace).toHaveBeenCalledWith('/dashboard');
  });

  it('does not redirect an authenticated visitor while MSAL is still processing a redirect response', () => {
    mockUseIsAuthenticated.mockReturnValue(true);
    mockInProgress = 'startup';
    render(<ConnectPage />);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
