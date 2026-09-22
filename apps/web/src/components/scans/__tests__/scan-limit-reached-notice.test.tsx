import { render, screen, fireEvent } from '@testing-library/react';
import { ScanLimitReachedNotice } from '../scan-limit-reached-notice';

// RequestUpgradeDialog's own form/success/error behavior is thoroughly
// covered by request-upgrade-dialog.test.tsx — mocked here to a minimal
// stand-in so this file only tests ScanLimitReachedNotice's own wiring.
jest.mock('@/components/dashboard/request-upgrade-dialog', () => ({
  RequestUpgradeDialog: ({
    open,
    onOpenChange,
    onSuccess,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Request an upgrade">
        <button onClick={() => onOpenChange(false)}>Cancel</button>
        <button onClick={onSuccess}>Simulate success</button>
      </div>
    ) : null,
}));

describe('ScanLimitReachedNotice (Phase 5/6)', () => {
  it('never says the scan failed or errored', () => {
    render(<ScanLimitReachedNotice documentsScanned={1850} />);

    expect(screen.queryByText(/fail/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it('clearly communicates the trial-limit distinction', () => {
    render(<ScanLimitReachedNotice documentsScanned={1850} />);

    expect(screen.getByText('Trial document limit reached during this scan')).toBeInTheDocument();
  });

  it('never implies existing documents disappear', () => {
    render(<ScanLimitReachedNotice documentsScanned={1850} />);

    expect(screen.getByText(/remain fully available/i)).toBeInTheDocument();
  });

  it('shows this scan\'s own documentsScanned count, not account-wide usage', () => {
    render(<ScanLimitReachedNotice documentsScanned={1850} />);

    expect(screen.getByText(/Documents indexed during this scan: 1,850\./)).toBeInTheDocument();
  });

  it('renders the "Request an upgrade" CTA, never the old placeholder "Upgrade" label', () => {
    render(<ScanLimitReachedNotice documentsScanned={1850} />);

    expect(screen.getByRole('button', { name: 'Request an upgrade' })).toBeInTheDocument();
  });

  it('opens the real request-upgrade dialog on click — never a fake acknowledgment or payment flow', () => {
    render(<ScanLimitReachedNotice documentsScanned={1850} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Request an upgrade' }));
    expect(screen.getByRole('dialog', { name: 'Request an upgrade' })).toBeInTheDocument();
  });

  it('shows "Upgrade request sent" after a successful request, replacing the CTA', () => {
    render(<ScanLimitReachedNotice documentsScanned={1850} />);

    fireEvent.click(screen.getByRole('button', { name: 'Request an upgrade' }));
    fireEvent.click(screen.getByRole('button', { name: 'Simulate success' }));

    expect(screen.getByText('Upgrade request sent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request an upgrade' })).not.toBeInTheDocument();
  });

  it('uses a non-interrupting status role, not an assertive alert', () => {
    render(<ScanLimitReachedNotice documentsScanned={1850} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
