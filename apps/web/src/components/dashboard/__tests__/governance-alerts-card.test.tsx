import { render, screen } from '@testing-library/react';
import type { OrganizationUserResponse, SharePointSiteResponse } from '@sph/types';
import { GovernanceAlertsCard } from '../governance-alerts-card';

function site(overrides: Partial<SharePointSiteResponse> = {}): SharePointSiteResponse {
  return {
    id: 'site-1',
    organizationId: 'org-1',
    microsoftTenantId: 'tenant-1',
    graphSiteId: 'graph-site-1',
    siteUrl: 'https://contoso.sharepoint.com/sites/marketing',
    displayName: 'Marketing',
    status: 'Discovered',
    approvedAt: null,
    approvedByUserId: null,
    lastScannedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function user(overrides: Partial<OrganizationUserResponse> = {}): OrganizationUserResponse {
  return {
    id: 'user-1',
    displayName: 'Sarah Kim',
    email: 'sarah@contoso.com',
    role: 'Member',
    status: 'PendingApproval',
    createdAt: '2026-07-01T00:00:00.000Z',
    lastLoginAt: null,
    ...overrides,
  };
}

describe('GovernanceAlertsCard', () => {
  it('shows an empty state when there are no pending sites or users', () => {
    render(<GovernanceAlertsCard sites={[]} users={[]} />);
    expect(screen.getByText('No pending approvals.')).toBeInTheDocument();
  });

  it('treats undefined sites/users (e.g. still loading, or non-Admin for users) the same as none', () => {
    render(<GovernanceAlertsCard sites={undefined} users={undefined} />);
    expect(screen.getByText('No pending approvals.')).toBeInTheDocument();
  });

  it('shows a pending-sites alert only counting Discovered-status sites', () => {
    render(<GovernanceAlertsCard sites={[site(), site({ id: 'site-2' }), site({ id: 'site-3', status: 'Approved' })]} users={[]} />);
    expect(screen.getByText('2 sites discovered, not yet approved for scanning')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review sites' })).toHaveAttribute('href', '/dashboard/sharepoint');
  });

  it('shows a pending-users alert only counting PendingApproval-status users', () => {
    render(<GovernanceAlertsCard sites={[]} users={[user(), user({ id: 'user-2', status: 'Active' })]} />);
    expect(screen.getByText('1 account pending admin approval')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review users' })).toHaveAttribute('href', '/dashboard/users');
  });

  it('shows both alerts together when both are pending', () => {
    render(<GovernanceAlertsCard sites={[site()]} users={[user()]} />);
    expect(screen.getByText('Sites awaiting approval')).toBeInTheDocument();
    expect(screen.getByText('Users awaiting approval')).toBeInTheDocument();
  });
});
