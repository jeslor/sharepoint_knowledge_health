import { render, screen, waitFor } from '@testing-library/react';
import { AuthGate } from '../auth-gate';
import { ApiError } from '@/lib/api/client';

const mockUseIsAuthenticated = jest.fn();
const mockReplace = jest.fn();
const mockUseCurrentUser = jest.fn();

jest.mock('@azure/msal-react', () => ({
  useIsAuthenticated: () => mockUseIsAuthenticated(),
  useMsal: () => ({ instance: { loginRedirect: jest.fn() }, accounts: [] }),
  AuthenticatedTemplate: ({ children }: { children: React.ReactNode }) =>
    mockUseIsAuthenticated() ? <>{children}</> : null,
  UnauthenticatedTemplate: ({ children }: { children: React.ReactNode }) =>
    mockUseIsAuthenticated() ? null : <>{children}</>,
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

describe('AuthGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCurrentUser.mockReturnValue({ user: undefined, loading: false, error: undefined });
  });

  it('renders a sign-in prompt instead of children when unauthenticated', () => {
    mockUseIsAuthenticated.mockReturnValue(false);

    render(
      <AuthGate>
        <div>Protected content</div>
      </AuthGate>,
    );

    expect(screen.getByText('Sign in required')).toBeInTheDocument();
    expect(screen.getByText('Sign in with Microsoft')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('renders children when authenticated and /auth/me resolved successfully', () => {
    mockUseIsAuthenticated.mockReturnValue(true);
    mockUseCurrentUser.mockReturnValue({ user: { organizationId: 'org-1' }, loading: false, error: undefined });

    render(
      <AuthGate>
        <div>Protected content</div>
      </AuthGate>,
    );

    expect(screen.getByText('Protected content')).toBeInTheDocument();
    expect(screen.queryByText('Sign in required')).not.toBeInTheDocument();
  });

  it('renders nothing (no blank-skeleton flash) while /auth/me is still loading', () => {
    mockUseIsAuthenticated.mockReturnValue(true);
    mockUseCurrentUser.mockReturnValue({ user: undefined, loading: true, error: undefined });

    const { container } = render(
      <AuthGate>
        <div>Protected content</div>
      </AuthGate>,
    );

    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    expect(container.textContent).toBe('');
  });

  // Root cause fix (2026-07-21): an authenticated user with no resolvable
  // organization must never be left staring at a permanently blank
  // dashboard — regardless of what upstream cause left them unprovisioned.
  describe('when GET /auth/me returns 403 "Organization not connected"', () => {
    beforeEach(() => {
      mockUseIsAuthenticated.mockReturnValue(true);
      mockUseCurrentUser.mockReturnValue({
        user: undefined,
        loading: false,
        error: new ApiError(403, 'Organization not connected'),
      });
    });

    it('redirects to /connect instead of rendering children', async () => {
      render(
        <AuthGate>
          <div>Protected content</div>
        </AuthGate>,
      );

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/connect'));
      expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    });
  });

  describe('when GET /auth/me returns 403 "Account pending approval"', () => {
    beforeEach(() => {
      mockUseIsAuthenticated.mockReturnValue(true);
      mockUseCurrentUser.mockReturnValue({
        user: undefined,
        loading: false,
        error: new ApiError(403, 'Account pending approval'),
      });
    });

    it('renders a pending-approval message, never children, and does not redirect to /connect (a real org already exists)', async () => {
      render(
        <AuthGate>
          <div>Protected content</div>
        </AuthGate>,
      );

      expect(await screen.findByText('Almost there')).toBeInTheDocument();
      expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  it('renders children when /auth/me fails with an unrelated error (fails open, does not treat every error as unprovisioned)', () => {
    mockUseIsAuthenticated.mockReturnValue(true);
    mockUseCurrentUser.mockReturnValue({ user: undefined, loading: false, error: new ApiError(500, 'Internal server error') });

    render(
      <AuthGate>
        <div>Protected content</div>
      </AuthGate>,
    );

    expect(screen.getByText('Protected content')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
