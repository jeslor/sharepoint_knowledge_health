import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import HomePage from '../page';

const mockReplace = jest.fn();
const mockUseIsAuthenticated = jest.fn();
const mockConsumeLastLoginState = jest.fn();
let mockInProgress = 'none';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@azure/msal-react', () => ({
  useIsAuthenticated: () => mockUseIsAuthenticated(),
  useMsal: () => ({ instance: { loginRedirect: jest.fn() }, inProgress: mockInProgress }),
}));

jest.mock('@/lib/auth/msal-instance', () => ({
  consumeLastLoginState: () => mockConsumeLastLoginState(),
}));

describe('HomePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInProgress = 'none';
    mockConsumeLastLoginState.mockReturnValue(null);
  });

  it('renders the product name', () => {
    mockUseIsAuthenticated.mockReturnValue(false);
    render(<HomePage />);
    expect(screen.getByText('SharePoint Knowledge Health')).toBeInTheDocument();
  });

  it('shows a sign-in button when unauthenticated', () => {
    mockUseIsAuthenticated.mockReturnValue(false);
    render(<HomePage />);
    expect(screen.getByText('Sign in with Microsoft')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('redirects to /dashboard once authenticated and settled (client-side, not a full reload)', () => {
    mockUseIsAuthenticated.mockReturnValue(true);
    render(<HomePage />);
    expect(mockReplace).toHaveBeenCalledWith('/dashboard');
  });

  it('does not redirect while MSAL is still processing the redirect response', () => {
    mockUseIsAuthenticated.mockReturnValue(true);
    mockInProgress = 'startup';
    render(<HomePage />);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  // Root cause regression tests (2026-07-22): the connect-flow marker used
  // to be a sessionStorage key that had to survive the MSAL sign-in
  // redirect round trip — live testing showed that hop losing the value
  // intermittently. It's now read out of MSAL's own `state` parameter via
  // consumeLastLoginState() instead, which login.microsoftonline.com
  // round-trips as part of the OAuth response itself.
  describe('Connect Microsoft 365 routing via consumeLastLoginState', () => {
    it('an existing/returning authenticated user with no captured login state still redirects straight to /dashboard', () => {
      mockConsumeLastLoginState.mockReturnValue(null);
      mockUseIsAuthenticated.mockReturnValue(true);
      render(<HomePage />);
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });

    it('a user completing sign-in with a connect-flow state payload is routed to /connect/finishing with the tenant name in the query string', () => {
      mockConsumeLastLoginState.mockReturnValue(JSON.stringify({ kind: 'connect', tenantName: 'Acme Corporation' }));
      mockUseIsAuthenticated.mockReturnValue(true);
      render(<HomePage />);
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/connect/finishing?tenantName=Acme%20Corporation');
    });

    it('treats an unparseable or wrong-shaped state payload as a plain sign-in (fails open to /dashboard)', () => {
      mockConsumeLastLoginState.mockReturnValue('not-json-at-all');
      mockUseIsAuthenticated.mockReturnValue(true);
      render(<HomePage />);
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });

    it('does not route to /connect/finishing while MSAL is still processing, even with a connect-flow state present', () => {
      mockConsumeLastLoginState.mockReturnValue(JSON.stringify({ kind: 'connect', tenantName: 'Acme Corporation' }));
      mockUseIsAuthenticated.mockReturnValue(true);
      mockInProgress = 'startup';
      render(<HomePage />);
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  // Root cause regression test (2026-07-22): confirmed via an isolated
  // StrictMode-wrapped render during this investigation that, without a
  // re-entry guard, React 18 Strict Mode's dev-only double-effect-
  // invocation called consumeLastLoginState() twice on mount — the first
  // call correctly consumed the real connect-flow state and called
  // router.replace('/connect/finishing?...'), but the second call always
  // saw null (consumeLastLoginState() clears on read) and called
  // router.replace('/dashboard') immediately after, which won since it was
  // the last call issued. This wraps the real component in
  // <React.StrictMode> specifically to exercise that double-invocation and
  // prove the consumedRef guard closes it.
  describe('React 18 Strict Mode safety (apps/web/next.config.ts sets reactStrictMode: true)', () => {
    it('under StrictMode, consumeLastLoginState is called only once and the correct target wins, even though the effect body runs twice', async () => {
      mockConsumeLastLoginState.mockReturnValue(JSON.stringify({ kind: 'connect', tenantName: 'Acme Corporation' }));
      mockUseIsAuthenticated.mockReturnValue(true);

      render(
        <React.StrictMode>
          <HomePage />
        </React.StrictMode>,
      );

      await waitFor(() => expect(mockReplace).toHaveBeenCalled());

      expect(mockConsumeLastLoginState).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/connect/finishing?tenantName=Acme%20Corporation');
    });
  });
});
