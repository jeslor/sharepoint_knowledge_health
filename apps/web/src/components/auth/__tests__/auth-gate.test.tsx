import { render, screen } from '@testing-library/react';
import { AuthGate } from '../auth-gate';

const mockUseIsAuthenticated = jest.fn();

jest.mock('@azure/msal-react', () => ({
  useIsAuthenticated: () => mockUseIsAuthenticated(),
  useMsal: () => ({ instance: { loginRedirect: jest.fn() }, accounts: [] }),
  AuthenticatedTemplate: ({ children }: { children: React.ReactNode }) =>
    mockUseIsAuthenticated() ? <>{children}</> : null,
  UnauthenticatedTemplate: ({ children }: { children: React.ReactNode }) =>
    mockUseIsAuthenticated() ? null : <>{children}</>,
}));

describe('AuthGate', () => {
  beforeEach(() => jest.clearAllMocks());

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

  it('renders children instead of the sign-in prompt when authenticated', () => {
    mockUseIsAuthenticated.mockReturnValue(true);

    render(
      <AuthGate>
        <div>Protected content</div>
      </AuthGate>,
    );

    expect(screen.getByText('Protected content')).toBeInTheDocument();
    expect(screen.queryByText('Sign in required')).not.toBeInTheDocument();
  });
});
