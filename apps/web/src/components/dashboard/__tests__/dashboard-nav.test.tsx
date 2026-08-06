import { render, screen, fireEvent, within } from '@testing-library/react';
import type { MeResponse } from '@sph/types';
import { DashboardNav } from '../dashboard-nav';

let mockUser: MeResponse | undefined;
let mockPathname = '/dashboard';
let mockUnreadCount: number | undefined;

jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => ({ user: mockUser, loading: false, error: undefined }),
}));

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('@/lib/api/hooks/use-unread-notification-count', () => ({
  useUnreadNotificationCount: () => ({
    data: mockUnreadCount === undefined ? undefined : { count: mockUnreadCount },
    loading: false,
    error: undefined,
    isRefetching: false,
    refetch: jest.fn(),
  }),
}));

function user(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: 'user-1',
    role: 'Member',
    organizationId: 'org-1',
    displayName: 'Sarah Kim',
    email: 'sarah@contoso.com',
    tenantName: 'Contoso Ltd.',
    ...overrides,
  };
}

// The desktop sidebar (an <aside>, role="complementary") is always mounted;
// the mobile drawer is now *also* always mounted (Phase 10A.3, so it can
// slide in/out), just visually/interactively hidden via CSS+aria-hidden
// when closed — so every nav item exists twice in the DOM regardless of
// mobileOpen. Scope queries to the desktop sidebar unless a test is
// specifically about the drawer.
function desktopSidebar(): HTMLElement {
  return screen.getByRole('complementary');
}

describe('DashboardNav', () => {
  const noop = (): void => {};

  beforeEach(() => {
    mockUser = undefined;
    mockPathname = '/dashboard';
    mockUnreadCount = undefined;
  });

  it('always shows the core product areas reachable by every role, in the desktop sidebar', () => {
    mockUser = user({ role: 'Member' });
    render(<DashboardNav mobileOpen={false} onCloseMobile={noop} />);

    const { getByRole } = within(desktopSidebar());
    expect(getByRole('link', { name: /overview/i })).toBeInTheDocument();
    expect(getByRole('link', { name: /documents/i })).toBeInTheDocument();
    expect(getByRole('link', { name: /scans/i })).toBeInTheDocument();
    expect(getByRole('link', { name: /governance/i })).toBeInTheDocument();
  });

  it('shows Notifications for every role — never role-gated, unlike Administration', () => {
    mockUser = user({ role: 'Member' });
    render(<DashboardNav mobileOpen={false} onCloseMobile={noop} />);

    expect(within(desktopSidebar()).getByRole('link', { name: /notifications/i })).toHaveAttribute(
      'href',
      '/dashboard/notifications',
    );
  });

  it('renders no unread badge when the unread count is zero', () => {
    mockUser = user({ role: 'Member' });
    mockUnreadCount = 0;
    render(<DashboardNav mobileOpen={false} onCloseMobile={noop} />);

    expect(within(desktopSidebar()).queryByLabelText(/unread/i)).not.toBeInTheDocument();
  });

  it('renders no unread badge while the count is still loading (undefined)', () => {
    mockUser = user({ role: 'Member' });
    mockUnreadCount = undefined;
    render(<DashboardNav mobileOpen={false} onCloseMobile={noop} />);

    expect(within(desktopSidebar()).queryByLabelText(/unread/i)).not.toBeInTheDocument();
  });

  it('shows the unread count as a badge on the Notifications link', () => {
    mockUser = user({ role: 'Member' });
    mockUnreadCount = 3;
    render(<DashboardNav mobileOpen={false} onCloseMobile={noop} />);

    expect(within(desktopSidebar()).getByLabelText('3 unread')).toHaveTextContent('3');
  });

  it('caps the displayed badge at "99+" for a large unread count', () => {
    mockUser = user({ role: 'Member' });
    mockUnreadCount = 250;
    render(<DashboardNav mobileOpen={false} onCloseMobile={noop} />);

    expect(within(desktopSidebar()).getByLabelText('250 unread')).toHaveTextContent('99+');
  });

  it('hides Sites and Users links for a Member', () => {
    mockUser = user({ role: 'Member' });
    render(<DashboardNav mobileOpen={false} onCloseMobile={noop} />);

    const { queryByRole } = within(desktopSidebar());
    expect(queryByRole('link', { name: /sites/i })).not.toBeInTheDocument();
    expect(queryByRole('link', { name: /users/i })).not.toBeInTheDocument();
  });

  it('hides Sites and Users links for a GovernanceManager', () => {
    mockUser = user({ role: 'GovernanceManager' });
    render(<DashboardNav mobileOpen={false} onCloseMobile={noop} />);

    const { queryByRole } = within(desktopSidebar());
    expect(queryByRole('link', { name: /sites/i })).not.toBeInTheDocument();
    expect(queryByRole('link', { name: /users/i })).not.toBeInTheDocument();
  });

  it('shows Sites and Users links for an Admin', () => {
    mockUser = user({ role: 'Admin' });
    render(<DashboardNav mobileOpen={false} onCloseMobile={noop} />);

    const { getByRole } = within(desktopSidebar());
    expect(getByRole('link', { name: /sites/i })).toHaveAttribute('href', '/dashboard/sharepoint');
    expect(getByRole('link', { name: /users/i })).toHaveAttribute('href', '/dashboard/users');
  });

  it('marks the link matching the current path as the active page', () => {
    mockUser = user({ role: 'Member' });
    mockPathname = '/dashboard/scans/scan-123';
    render(<DashboardNav mobileOpen={false} onCloseMobile={noop} />);

    const { getByRole } = within(desktopSidebar());
    expect(getByRole('link', { name: /scans/i })).toHaveAttribute('aria-current', 'page');
    expect(getByRole('link', { name: /documents/i })).not.toHaveAttribute('aria-current');
  });

  it('only marks Overview active on the exact /dashboard path, not every nested route', () => {
    mockUser = user({ role: 'Member' });
    mockPathname = '/dashboard/documents';
    render(<DashboardNav mobileOpen={false} onCloseMobile={noop} />);

    expect(within(desktopSidebar()).getByRole('link', { name: /overview/i })).not.toHaveAttribute('aria-current');
  });

  it('keeps the mobile drawer mounted but visually/interactively hidden when mobileOpen is false (so it can slide in)', () => {
    mockUser = user();
    render(<DashboardNav mobileOpen={false} onCloseMobile={noop} />);

    // aria-hidden on the wrapper correctly removes it from the a11y tree,
    // so `hidden: true` is needed to still find it and assert on the
    // underlying CSS/attributes that produce that hidden state.
    const drawer = screen.getByRole('navigation', { name: /main navigation/i, hidden: true });
    expect(drawer.className).toContain('-translate-x-full');
    expect(drawer.parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(drawer.parentElement?.className).toContain('pointer-events-none');
  });

  it('slides the mobile drawer into view and clears aria-hidden when mobileOpen is true', () => {
    mockUser = user();
    render(<DashboardNav mobileOpen onCloseMobile={noop} />);

    const drawer = screen.getByRole('navigation', { name: /main navigation/i });
    expect(drawer.className).toContain('translate-x-0');
    expect(drawer.parentElement).toHaveAttribute('aria-hidden', 'false');
  });

  it('renders the mobile drawer when mobileOpen is true, and clicking a link inside it calls onCloseMobile', () => {
    mockUser = user();
    const onCloseMobile = jest.fn();
    render(<DashboardNav mobileOpen onCloseMobile={onCloseMobile} />);

    const drawer = screen.getByRole('navigation', { name: /main navigation/i });
    fireEvent.click(within(drawer).getByRole('link', { name: /documents/i }));
    expect(onCloseMobile).toHaveBeenCalled();
  });

  it('groups links under "Workspace" and "Administration" section captions', () => {
    mockUser = user({ role: 'Admin' });
    render(<DashboardNav mobileOpen={false} onCloseMobile={noop} />);

    const { getByRole } = within(desktopSidebar());
    expect(getByRole('button', { name: /workspace/i })).toBeInTheDocument();
    expect(getByRole('button', { name: /administration/i })).toBeInTheDocument();
  });

  it('hides the Administration group entirely for a non-admin, not just its links', () => {
    mockUser = user({ role: 'Member' });
    render(<DashboardNav mobileOpen={false} onCloseMobile={noop} />);

    expect(within(desktopSidebar()).queryByRole('button', { name: /administration/i })).not.toBeInTheDocument();
  });

  it("collapses a group's links when its caption is clicked, and expands them again on a second click", () => {
    mockUser = user({ role: 'Member' });
    render(<DashboardNav mobileOpen={false} onCloseMobile={noop} />);

    const { getByRole, queryByRole } = within(desktopSidebar());
    const workspaceToggle = getByRole('button', { name: /workspace/i });
    expect(workspaceToggle).toHaveAttribute('aria-expanded', 'true');
    expect(getByRole('link', { name: /documents/i })).toBeInTheDocument();

    fireEvent.click(workspaceToggle);
    expect(workspaceToggle).toHaveAttribute('aria-expanded', 'false');
    expect(queryByRole('link', { name: /documents/i })).not.toBeInTheDocument();

    fireEvent.click(workspaceToggle);
    expect(workspaceToggle).toHaveAttribute('aria-expanded', 'true');
    expect(getByRole('link', { name: /documents/i })).toBeInTheDocument();
  });
});
