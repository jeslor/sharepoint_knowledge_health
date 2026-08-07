import { render, screen } from '@testing-library/react';
import type { AuditLogResponse } from '@sph/types';
import { AuditLogList } from '../audit-log-list';

function entry(overrides: Partial<AuditLogResponse> = {}): AuditLogResponse {
  return {
    id: 'audit-1',
    actorUserId: 'user-1',
    actorUserName: 'Sarah Kim',
    action: 'user.approved',
    targetType: 'User',
    targetId: 'user-2',
    metadata: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('AuditLogList', () => {
  it('renders an entry with its action label, actor, and target', () => {
    render(<AuditLogList entries={[entry({ actorUserName: 'Sarah Kim' })]} />);

    expect(screen.getByText('User approved')).toBeInTheDocument();
    expect(screen.getByText('Sarah Kim')).toBeInTheDocument();
  });

  it('groups entries by day', () => {
    const today = entry({ id: 'a', createdAt: new Date().toISOString() });
    const older = entry({
      id: 'b',
      action: 'sharepoint_site.approved',
      createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    render(<AuditLogList entries={[today, older]} />);

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('5 days ago')).toBeInTheDocument();
  });

  it('renders the mapped human-readable label for a known action', () => {
    render(<AuditLogList entries={[entry({ action: 'sharepoint_site.revoked' })]} />);
    expect(screen.getByText('Site access revoked')).toBeInTheDocument();
  });

  it('falls back to the raw action string for an unmapped action', () => {
    render(<AuditLogList entries={[entry({ action: 'future.action_type' })]} />);
    expect(screen.getByText('future.action_type')).toBeInTheDocument();
  });

  it('renders "System" for a null actor (the reserved system-driven case)', () => {
    render(<AuditLogList entries={[entry({ actorUserId: null, actorUserName: null })]} />);
    expect(screen.getByText('System')).toBeInTheDocument();
  });

  it('renders "Unknown user" exactly as provided by the backend, without extra lookup logic', () => {
    render(<AuditLogList entries={[entry({ actorUserId: 'user-deleted', actorUserName: 'Unknown user' })]} />);
    expect(screen.getByText('Unknown user')).toBeInTheDocument();
  });

  it('links a ScanJob target to its scan detail page', () => {
    render(<AuditLogList entries={[entry({ action: 'scan.triggered', targetType: 'ScanJob', targetId: 'scan-42' })]} />);

    const link = screen.getByRole('link', { name: 'Scan' });
    expect(link).toHaveAttribute('href', '/dashboard/scans/scan-42');
  });

  it.each(['User', 'SharePointSite', 'ScanSchedule', 'MicrosoftTenant'] as const)(
    'does not create a link for an unsupported target type (%s)',
    (targetType) => {
      render(<AuditLogList entries={[entry({ targetType, targetId: 'some-id' })]} />);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    },
  );

  it('shows an empty state when there is no audit history', () => {
    render(<AuditLogList entries={[]} />);
    expect(screen.getByText(/no audit history yet/i)).toBeInTheDocument();
  });
});
