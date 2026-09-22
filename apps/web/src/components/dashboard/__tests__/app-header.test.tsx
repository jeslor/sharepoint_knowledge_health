import { render, screen, fireEvent } from '@testing-library/react';
import type { MeResponse } from '@sph/types';
import { AppHeader } from '../app-header';

let mockUser: MeResponse | undefined;

jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => ({ user: mockUser, loading: false, error: undefined }),
}));

jest.mock('@azure/msal-react', () => ({
  useMsal: () => ({ instance: { logoutRedirect: jest.fn() } }),
}));

describe('AppHeader', () => {
  beforeEach(() => {
    mockUser = undefined;
  });

  it('shows the product wordmark and a sign-out action', () => {
    render(<AppHeader mobileNavOpen={false} onToggleMobileNav={jest.fn()} />);

    expect(screen.getByText('SharePoint Knowledge Health')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('shows the connected tenant name and user display name once loaded', () => {
    mockUser = { id: 'user-1', role: 'Admin', organizationId: 'org-1', displayName: 'Sarah Kim', email: 's@contoso.com', organizationName: 'Contoso Corp', tenantName: 'Contoso Ltd.' };
    render(<AppHeader mobileNavOpen={false} onToggleMobileNav={jest.fn()} />);

    expect(screen.getByText('Contoso Ltd.')).toBeInTheDocument();
    expect(screen.getByText('Sarah Kim')).toBeInTheDocument();
  });

  it('omits the tenant label when there is no connected tenant', () => {
    mockUser = { id: 'user-1', role: 'Admin', organizationId: 'org-1', displayName: 'Sarah Kim', email: 's@contoso.com', organizationName: 'Contoso Corp', tenantName: null };
    render(<AppHeader mobileNavOpen={false} onToggleMobileNav={jest.fn()} />);

    expect(screen.getByText('Sarah Kim')).toBeInTheDocument();
  });

  it('calls onToggleMobileNav when the hamburger button is clicked', () => {
    const onToggleMobileNav = jest.fn();
    render(<AppHeader mobileNavOpen={false} onToggleMobileNav={onToggleMobileNav} />);

    fireEvent.click(screen.getByRole('button', { name: /toggle navigation menu/i }));
    expect(onToggleMobileNav).toHaveBeenCalled();
  });

  it('reflects the open state via aria-expanded', () => {
    render(<AppHeader mobileNavOpen onToggleMobileNav={jest.fn()} />);
    expect(screen.getByRole('button', { name: /toggle navigation menu/i })).toHaveAttribute('aria-expanded', 'true');
  });

  it('links out to the Microsoft 365 admin center with proper external-link security attributes', () => {
    render(<AppHeader mobileNavOpen={false} onToggleMobileNav={jest.fn()} />);

    const link = screen.getByRole('link', { name: /open microsoft 365 admin center/i });
    expect(link).toHaveAttribute('href', 'https://admin.microsoft.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
