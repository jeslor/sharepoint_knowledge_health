import { render, screen } from '@testing-library/react';
import type { MeResponse } from '@sph/types';
import { DashboardNav } from '../dashboard-nav';

let mockUser: MeResponse | undefined;

jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => ({ user: mockUser, loading: false, error: undefined }),
}));

describe('DashboardNav', () => {
  beforeEach(() => {
    mockUser = undefined;
  });

  it('always shows the core product areas reachable by every role', () => {
    mockUser = { id: 'user-1', role: 'Member', organizationId: 'org-1' };
    render(<DashboardNav />);

    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scans' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Governance' })).toBeInTheDocument();
  });

  it('hides Sites and Users links for a Member', () => {
    mockUser = { id: 'user-1', role: 'Member', organizationId: 'org-1' };
    render(<DashboardNav />);

    expect(screen.queryByRole('link', { name: 'Sites' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('hides Sites and Users links for a GovernanceManager', () => {
    mockUser = { id: 'user-1', role: 'GovernanceManager', organizationId: 'org-1' };
    render(<DashboardNav />);

    expect(screen.queryByRole('link', { name: 'Sites' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('shows Sites and Users links for an Admin', () => {
    mockUser = { id: 'user-1', role: 'Admin', organizationId: 'org-1' };
    render(<DashboardNav />);

    expect(screen.getByRole('link', { name: 'Sites' })).toHaveAttribute('href', '/dashboard/sharepoint');
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/dashboard/users');
  });
});
