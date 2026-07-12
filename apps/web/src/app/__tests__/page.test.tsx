import { render, screen } from '@testing-library/react';
import HomePage from '../page';

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
});
