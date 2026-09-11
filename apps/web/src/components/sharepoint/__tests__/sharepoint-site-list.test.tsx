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

  it('renders a Manage review dates button linking to the review-dates page for an Approved site', () => {
    render(<SharePointSiteList sites={[site({ status: 'Approved' })]} canManage onApprove={jest.fn()} onRevoke={jest.fn()} mutatingSiteId={null} />);

    const link = screen.getByRole('link', { name: 'Manage review dates' });
    expect(link).toHaveAttribute('href', '/dashboard/sharepoint/site-1/review-dates');
    // Clearly-visible button styling (buttonClassName), not a plain text link.
    expect(link).toHaveClass('rounded-lg');
  });

  it('does not link to review dates for a site that is not yet Approved', () => {
    render(<SharePointSiteList sites={[site({ status: 'Discovered' })]} canManage onApprove={jest.fn()} onRevoke={jest.fn()} mutatingSiteId={null} />);

    expect(screen.queryByRole('link', { name: 'Manage review dates' })).not.toBeInTheDocument();
  });

  it('still shows the Manage review dates button for an Approved site when canManage is false', () => {
    render(<SharePointSiteList sites={[site({ status: 'Approved' })]} canManage={false} onApprove={jest.fn()} onRevoke={jest.fn()} mutatingSiteId={null} />);

    expect(screen.getByRole('link', { name: 'Manage review dates' })).toBeInTheDocument();
  });

  // Root cause regression test (2026-07-25): the action button used to be
  // three mutually-exclusive JSX branches, so a status change unmounted one
  // Button and mounted a different one — a hard swap CSS transitions can't
  // animate across. It must now be the same persistent element throughout.
  it('keeps the same button DOM node across a status transition (no remount)', () => {
    const { rerender } = render(
      <SharePointSiteList sites={[site({ status: 'Discovered' })]} canManage onApprove={jest.fn()} onRevoke={jest.fn()} mutatingSiteId={null} />,
    );
    const approveButton = screen.getByRole('button', { name: /approve/i });

    rerender(
      <SharePointSiteList sites={[site({ status: 'Approved' })]} canManage onApprove={jest.fn()} onRevoke={jest.fn()} mutatingSiteId={null} />,
    );
    const revokeButton = screen.getByRole('button', { name: /revoke/i });

    expect(revokeButton).toBe(approveButton); // same DOM node, only its props/text changed
  });
});
