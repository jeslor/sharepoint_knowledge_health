import { render, screen, fireEvent } from '@testing-library/react';
import type { SharePointSiteResponse } from '@sph/types';
import { SharePointSiteList } from '../sharepoint-site-list';

function site(overrides: Partial<SharePointSiteResponse> = {}): SharePointSiteResponse {
  return {
    id: 'site-1',
    organizationId: 'org-1',
    microsoftTenantId: 'tenant-1',
    graphSiteId: 'graph-site-1',
    siteUrl: 'https://contoso.sharepoint.com/sites/team',
    displayName: 'Team Site',
    status: 'Discovered',
    approvedAt: null,
    approvedByUserId: null,
    lastScannedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SharePointSiteList', () => {
  it('renders an empty state when there are no sites', () => {
    render(<SharePointSiteList sites={[]} canManage onApprove={jest.fn()} onRevoke={jest.fn()} mutatingSiteId={null} />);
    expect(screen.getByText('No SharePoint sites match this filter yet.')).toBeInTheDocument();
  });

  it('shows an Approve button for a Discovered site when canManage, and calls onApprove', () => {
    const onApprove = jest.fn();
    render(<SharePointSiteList sites={[site()]} canManage onApprove={onApprove} onRevoke={jest.fn()} mutatingSiteId={null} />);

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    expect(onApprove).toHaveBeenCalledWith('site-1');
  });

  it('shows a Revoke action for an Approved site when canManage, and calls onRevoke', () => {
    const onRevoke = jest.fn();
    render(
      <SharePointSiteList sites={[site({ status: 'Approved' })]} canManage onApprove={jest.fn()} onRevoke={onRevoke} mutatingSiteId={null} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /revoke/i }));

    expect(onRevoke).toHaveBeenCalledWith('site-1');
  });

  it('shows a Re-approve action for a Removed site when canManage, reusing onApprove', () => {
    const onApprove = jest.fn();
    render(
      <SharePointSiteList sites={[site({ status: 'Removed' })]} canManage onApprove={onApprove} onRevoke={jest.fn()} mutatingSiteId={null} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /re-approve/i }));

    expect(onApprove).toHaveBeenCalledWith('site-1');
  });

  it('hides all actions and the Actions column when canManage is false', () => {
    render(<SharePointSiteList sites={[site()]} canManage={false} onApprove={jest.fn()} onRevoke={jest.fn()} mutatingSiteId={null} />);

    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /actions/i })).not.toBeInTheDocument();
  });

  it('shows "Never" when a site has not been scanned yet', () => {
    render(<SharePointSiteList sites={[site()]} canManage onApprove={jest.fn()} onRevoke={jest.fn()} mutatingSiteId={null} />);

    expect(screen.getByText('Never')).toBeInTheDocument();
  });
});
