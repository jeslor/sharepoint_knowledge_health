import { render, screen, fireEvent } from '@testing-library/react';
import { ScanLimitReachedNotice } from '../scan-limit-reached-notice';

describe('ScanLimitReachedNotice (Phase 5)', () => {
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

  it('renders the Upgrade CTA', () => {
    render(<ScanLimitReachedNotice documentsScanned={1850} />);

    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument();
  });

  it('shows an honest, non-fake acknowledgment after clicking Upgrade — never a fake "request sent" or payment flow', () => {
    render(<ScanLimitReachedNotice documentsScanned={1850} />);

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }));

    expect(screen.getByText(/aren.t available directly in the app yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('uses a non-interrupting status role, not an assertive alert', () => {
    render(<ScanLimitReachedNotice documentsScanned={1850} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
