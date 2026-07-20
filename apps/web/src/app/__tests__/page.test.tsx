import { render, screen } from '@testing-library/react';
import HomePage from '../page';
import { startConnectFlow } from '@/lib/auth/connect-flow';

const mockReplace = jest.fn();
const mockUseIsAuthenticated = jest.fn();
let mockInProgress = 'none';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@azure/msal-react', () => ({
  useIsAuthenticated: () => mockUseIsAuthenticated(),
  useMsal: () => ({ instance: { loginRedirect: jest.fn() }, inProgress: mockInProgress }),
}));

describe('HomePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInProgress = 'none';
    sessionStorage.clear();
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

  // Phase 6 regression tests — the sessionStorage marker check must not
  // alter behavior for anyone who never went through /connect.
  describe('Phase 6 — Connect Microsoft 365 routing', () => {
    it('an existing/returning authenticated user with no connect-flow marker still redirects straight to /dashboard', () => {
      // No startConnectFlow() call — sessionStorage is empty, matching
      // every returning user's real sessionStorage state.
      mockUseIsAuthenticated.mockReturnValue(true);
      render(<HomePage />);
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/dashboard');
    });

    it('a user completing sign-in with a connect-flow marker present is routed to /connect/finishing instead', () => {
      startConnectFlow('Acme Corporation');
      mockUseIsAuthenticated.mockReturnValue(true);
      render(<HomePage />);
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/connect/finishing');
    });

    it('does not route to /connect/finishing while MSAL is still processing, even with a marker present', () => {
      startConnectFlow('Acme Corporation');
      mockUseIsAuthenticated.mockReturnValue(true);
      mockInProgress = 'startup';
      render(<HomePage />);
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });
});
