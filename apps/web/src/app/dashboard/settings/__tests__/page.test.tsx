import { render, screen, fireEvent } from '@testing-library/react';
import type { MeResponse } from '@sph/types';
import SettingsPage from '../page';

const mockUseCurrentUser = jest.fn();

jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

function user(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: 'user-1',
    role: 'Admin',
    organizationId: 'org-1',
    displayName: 'Sarah Kim',
    email: 'sarah@contoso.com',
    organizationName: 'Contoso Corp',
    tenantName: 'Contoso Ltd.',
    needsReconsent: false,
    ...overrides,
  };
}

describe('SettingsPage (ADR-0023 §3.8 re-consent entry point)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, href: '' },
    });
  });

  it('shows a restricted message and no refresh action for a non-Admin (authorization: non-admin cannot initiate re-consent)', () => {
    mockUseCurrentUser.mockReturnValue({ user: user({ role: 'Member' }) });
    render(<SettingsPage />);

    expect(screen.getByText(/only an admin can manage organization settings/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refresh microsoft 365 permissions/i })).not.toBeInTheDocument();
  });

  it('shows the connected tenant and the refresh action for an Admin (authorization: admin can initiate re-consent)', () => {
    mockUseCurrentUser.mockReturnValue({ user: user({ role: 'Admin' }) });
    render(<SettingsPage />);

    expect(screen.getByText(/connected to contoso ltd\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh microsoft 365 permissions/i })).toBeInTheDocument();
  });

  it('does not show the "needs attention" banner when needsReconsent is false (non-blocking for core functionality)', () => {
    mockUseCurrentUser.mockReturnValue({ user: user({ needsReconsent: false }) });
    render(<SettingsPage />);

    expect(screen.queryByText(/some permissions for this organization may need to be refreshed/i)).not.toBeInTheDocument();
  });

  it('shows the "needs attention" banner when needsReconsent is true, without blocking the refresh action', () => {
    mockUseCurrentUser.mockReturnValue({ user: user({ needsReconsent: true }) });
    render(<SettingsPage />);

    expect(screen.getByText(/some permissions for this organization may need to be refreshed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh microsoft 365 permissions/i })).toBeEnabled();
  });

  it('never claims write access is verified merely because consent was completed', () => {
    mockUseCurrentUser.mockReturnValue({ user: user({ needsReconsent: true }) });
    render(<SettingsPage />);

    expect(screen.queryByText(/write access (is |has been )?verified/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/permission granted/i)).not.toBeInTheDocument();
  });

  it('clicking "Refresh Microsoft 365 permissions" reuses the existing /connect OAuth plumbing (buildAdminConsentUrl), not a second implementation', () => {
    mockUseCurrentUser.mockReturnValue({ user: user() });
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: /refresh microsoft 365 permissions/i }));

    const storedState = sessionStorage.getItem('sph:connect:state');
    expect(storedState).toBeTruthy();
    expect(sessionStorage.getItem('sph:connect:tenantName')).toBe('Contoso Ltd.');

    expect(window.location.href).toContain('https://login.microsoftonline.com/organizations/adminconsent?');
    const navigatedUrl = new URL(window.location.href);
    expect(navigatedUrl.searchParams.get('client_id')).toBe('test-client-id');
    expect(navigatedUrl.searchParams.get('state')).toBe(storedState);
    expect(navigatedUrl.searchParams.get('redirect_uri')).toContain('/connect/admin-consent-callback');
    // No scope parameter — the manifest-driven app-only consent model this
    // codebase already correctly assumes (ADR-0003's investigation).
    expect(navigatedUrl.searchParams.has('scope')).toBe(false);
  });
});
