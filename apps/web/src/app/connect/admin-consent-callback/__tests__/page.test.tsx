import { render, screen, fireEvent } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
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

  // Root cause regression test (2026-07-22): the tenant name used to be
  // carried forward via sessionStorage alone, expected to survive the
  // upcoming MSAL sign-in redirect round trip — live testing showed that
  // hop losing the value intermittently. It's now embedded directly in
  // loginRedirect's own `state` parameter, which login.microsoftonline.com
  // round-trips as part of the OAuth response itself.
  it('embeds the tenant name in loginRedirect\'s own state parameter', () => {
    const state = startConnectFlow('Acme Corporation');
    mockSearchParams = new URLSearchParams({ tenant: 'tid-1', admin_consent: 'True', state });

    render(<AdminConsentCallbackPage />);
    fireEvent.click(screen.getByRole('button', { name: /continue to sign-in/i }));

    expect(mockLoginRedirect).toHaveBeenCalledWith(
      expect.objectContaining({ state: JSON.stringify({ kind: 'connect', tenantName: 'Acme Corporation' }) }),
    );
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

  // Root cause regression test (2026-07-22): admin_consent/state come from
  // the real request query string and are safe to read during Next.js's
  // server render of this page, but stateValid used to be computed from
  // sessionStorage in the same render pass — sessionStorage does not exist
  // during a server render. That crashed outright (the originally-reported
  // "ReferenceError: sessionStorage is not defined"); guarding it to return
  // `false` instead just swapped the crash for a wrong answer: the server
  // always rendered "This link has expired" regardless of the real state,
  // sent as real HTML, then React discarded and regenerated the tree once
  // the client hydrated with the correct answer — a confirmed, reproduced
  // hydration mismatch, not just a theoretical one. renderToString exercises
  // exactly the code path Next.js's server render does (render phase only,
  // no effects) — this proves neither failure mode is reachable anymore.
  it('never reads sessionStorage during a server-side render — no crash, and no incorrect "This link has expired" HTML sent to the client', () => {
    mockSearchParams = new URLSearchParams({ tenant: 'tid-1', admin_consent: 'True', state: 'some-state' });

    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new ReferenceError('sessionStorage is not defined');
      },
    });

    try {
      let html = '';
      expect(() => {
        html = renderToString(<AdminConsentCallbackPage />);
      }).not.toThrow();

      expect(html).not.toContain('This link has expired');
      expect(html).not.toContain('Permission granted');
    } finally {
      if (originalDescriptor) Object.defineProperty(window, 'sessionStorage', originalDescriptor);
    }
  });
});
