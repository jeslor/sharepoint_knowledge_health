import { render, screen, fireEvent } from '@testing-library/react';
import AdminConsentCallbackPage from '../page';
import { startConnectFlow } from '@/lib/auth/connect-flow';

const mockLoginRedirect = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

jest.mock('@azure/msal-react', () => ({
  useMsal: () => ({ instance: { loginRedirect: mockLoginRedirect } }),
}));

describe('AdminConsentCallbackPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    mockSearchParams = new URLSearchParams();
  });

  it('shows "Continue to sign-in" when admin_consent succeeded and state matches, and triggers loginRedirect on click', () => {
    const state = startConnectFlow('Acme Corporation');
    mockSearchParams = new URLSearchParams({ tenant: 'tid-1', admin_consent: 'True', state });

    render(<AdminConsentCallbackPage />);

    expect(screen.getByText('Permission granted')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /continue to sign-in/i });
    fireEvent.click(button);
    expect(mockLoginRedirect).toHaveBeenCalledTimes(1);
  });

  it('shows an expired/replay error and no sign-in button when state does not match sessionStorage', () => {
    startConnectFlow('Acme Corporation');
    mockSearchParams = new URLSearchParams({ tenant: 'tid-1', admin_consent: 'True', state: 'wrong-state' });

    render(<AdminConsentCallbackPage />);

    expect(screen.getByText('This link has expired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue to sign-in/i })).not.toBeInTheDocument();
  });

  it('shows an expired/replay error when no connect flow was ever started (no sessionStorage entry)', () => {
    mockSearchParams = new URLSearchParams({ tenant: 'tid-1', admin_consent: 'True', state: 'some-state' });

    render(<AdminConsentCallbackPage />);

    expect(screen.getByText('This link has expired')).toBeInTheDocument();
  });

  it('shows a cancellation message for error=access_denied with the Microsoft-provided description', () => {
    mockSearchParams = new URLSearchParams({
      error: 'access_denied',
      error_description: 'The admin declined the request.',
    });

    render(<AdminConsentCallbackPage />);

    expect(screen.getByText('You cancelled the connection')).toBeInTheDocument();
    expect(screen.getByText('The admin declined the request.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue to sign-in/i })).not.toBeInTheDocument();
  });

  it('shows the generic denial message for any other Microsoft error code (proves single-renderer design)', () => {
    mockSearchParams = new URLSearchParams({
      error: 'unauthorized_client',
      error_description: 'This app requires admin approval.',
    });

    render(<AdminConsentCallbackPage />);

    expect(screen.getByText('Admin consent could not be completed')).toBeInTheDocument();
    expect(screen.getByText('This app requires admin approval.')).toBeInTheDocument();
  });

  it('falls back to a generic message when an error code has no error_description, without crashing', () => {
    mockSearchParams = new URLSearchParams({ error: 'server_error' });

    render(<AdminConsentCallbackPage />);

    expect(screen.getByText('Admin consent could not be completed')).toBeInTheDocument();
    expect(
      screen.getByText(/you may need global administrator privileges/i),
    ).toBeInTheDocument();
  });

  it('provides a "Try again" link back to /connect on the error branch', () => {
    mockSearchParams = new URLSearchParams({ error: 'access_denied' });

    render(<AdminConsentCallbackPage />);

    const link = screen.getByRole('link', { name: /try again/i });
    expect(link).toHaveAttribute('href', '/connect');
  });
});
