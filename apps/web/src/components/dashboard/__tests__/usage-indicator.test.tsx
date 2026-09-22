import { render, screen, fireEvent } from '@testing-library/react';
import type { UsageResponse } from '@sph/types';
import { UsageIndicator } from '../usage-indicator';

// RequestUpgradeDialog's own hook-driven form/success/error behavior is
// thoroughly covered by request-upgrade-dialog.test.tsx — mocked here to a
// minimal stand-in so this file only tests UsageIndicator's own wiring
// (does the CTA render, does it open the dialog, does the sidebar react to
// a successful request).
jest.mock('../request-upgrade-dialog', () => ({
  RequestUpgradeDialog: ({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (open: boolean) => void; onSuccess?: () => void }) =>
    open ? (
      <div role="dialog" aria-label="Request an upgrade">
        <button onClick={() => onOpenChange(false)}>Cancel</button>
        <button onClick={onSuccess}>Simulate success</button>
      </div>
    ) : null,
}));

function usage(overrides: Partial<UsageResponse> = {}): UsageResponse {
  return {
    planType: 'Trial',
    documentLimit: 2000,
    currentDocumentCount: 1000,
    remainingDocumentCount: 1000,
    usagePercentage: 50,
    limitReached: false,
    ...overrides,
  };
}

describe('UsageIndicator (Phase 5)', () => {
  it('shows a loading skeleton and never flashes 0 / documentLimit before the response arrives', () => {
    render(<UsageIndicator usage={undefined} loading error={undefined} />);

    expect(screen.getByRole('status', { name: 'Loading document usage' })).toBeInTheDocument();
    expect(screen.queryByText(/0 \//)).not.toBeInTheDocument();
    expect(screen.queryByText('Document usage')).not.toBeInTheDocument();
  });

  it('renders a small non-blocking fallback on error, never a default/invented usage value', () => {
    render(<UsageIndicator usage={undefined} loading={false} error={new Error('Network error')} />);

    expect(screen.getByText('Document usage unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/2,000/)).not.toBeInTheDocument();
  });

  it('renders nothing when there is no usage yet and no error (e.g. not authenticated)', () => {
    const { container } = render(<UsageIndicator usage={undefined} loading={false} error={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a Standard-plan organization — no invented unlimited/neutral messaging', () => {
    const { container } = render(<UsageIndicator usage={usage({ planType: 'Standard' })} loading={false} error={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  describe('Trial organization below 75%', () => {
    it('shows the plain count and remaining documents, with no warning text or percentage', () => {
      render(<UsageIndicator usage={usage({ currentDocumentCount: 1000, documentLimit: 2000, remainingDocumentCount: 1000, usagePercentage: 50 })} loading={false} error={undefined} />);

      expect(screen.getByText('1,000')).toBeInTheDocument();
      expect(screen.getByText('/ 2,000')).toBeInTheDocument();
      expect(screen.getByText('1,000 documents remaining')).toBeInTheDocument();
      expect(screen.queryByText(/used\)/)).not.toBeInTheDocument();
      expect(screen.queryByText(/approaching/i)).not.toBeInTheDocument();
      expect(screen.queryByText('Trial limit reached')).not.toBeInTheDocument();
    });
  });

  describe('Trial organization at 75%', () => {
    it('shows a subtle contextual percentage indication without an interrupting warning sentence', () => {
      render(
        <UsageIndicator
          usage={usage({ currentDocumentCount: 1500, documentLimit: 2000, remainingDocumentCount: 500, usagePercentage: 75 })}
          loading={false}
          error={undefined}
        />,
      );

      expect(screen.getByText('500 documents remaining')).toBeInTheDocument();
      expect(screen.getByText('(75% used)')).toBeInTheDocument();
      expect(screen.queryByText(/approaching/i)).not.toBeInTheDocument();
    });
  });

  describe('Trial organization between 90-99%', () => {
    it('shows a clear, non-blocking warning sentence with the remaining count', () => {
      render(
        <UsageIndicator
          usage={usage({ currentDocumentCount: 1900, documentLimit: 2000, remainingDocumentCount: 100, usagePercentage: 95 })}
          loading={false}
          error={undefined}
        />,
      );

      expect(screen.getByText(/You’re approaching your trial document limit\. 100 documents remaining\./)).toBeInTheDocument();
    });

    it('never shows a warning through color alone — the warning icon and text are always present', () => {
      const { container } = render(
        <UsageIndicator
          usage={usage({ currentDocumentCount: 1950, documentLimit: 2000, remainingDocumentCount: 50, usagePercentage: 97.5 })}
          loading={false}
          error={undefined}
        />,
      );

      expect(container.querySelector('svg')).toBeInTheDocument();
      expect(screen.getByText(/approaching/i)).toBeInTheDocument();
    });
  });

  describe('Trial organization exactly at 2,000 (limitReached)', () => {
    const atLimit = usage({ currentDocumentCount: 2000, documentLimit: 2000, remainingDocumentCount: 0, usagePercentage: 100, limitReached: true });

    it('shows the limit-reached state clearly, never as a failure', () => {
      render(<UsageIndicator usage={atLimit} loading={false} error={undefined} />);

      expect(screen.getByText('Trial limit reached')).toBeInTheDocument();
      expect(screen.getByText('2,000')).toBeInTheDocument();
      expect(screen.queryByText(/fail/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
    });

    it('renders the "Request an upgrade" CTA at the limit-reached state, never the old placeholder "Upgrade" label', () => {
      render(<UsageIndicator usage={atLimit} loading={false} error={undefined} />);
      expect(screen.getByRole('button', { name: 'Request an upgrade' })).toBeInTheDocument();
    });

    it('opens the request-upgrade dialog when the CTA is clicked, and it can be closed again via Cancel', () => {
      render(<UsageIndicator usage={atLimit} loading={false} error={undefined} />);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Request an upgrade' }));
      expect(screen.getByRole('dialog', { name: 'Request an upgrade' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not automatically open the dialog just because the organization is at 100% — the user must initiate it', () => {
      render(<UsageIndicator usage={atLimit} loading={false} error={undefined} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('shows "Upgrade request sent" in the sidebar after a successful request, replacing the CTA', () => {
      render(<UsageIndicator usage={atLimit} loading={false} error={undefined} />);

      fireEvent.click(screen.getByRole('button', { name: 'Request an upgrade' }));
      fireEvent.click(screen.getByRole('button', { name: 'Simulate success' }));

      expect(screen.getByText('Upgrade request sent')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Request an upgrade' })).not.toBeInTheDocument();
    });

    it('never trusts a re-derived limit condition — renders limitReached purely from the backend field, even if the percentage math would disagree', () => {
      // documentLimit 0 makes usagePercentage null (defensive guard) — the
      // component must still trust limitReached as the sole authority.
      render(<UsageIndicator usage={usage({ documentLimit: 0, currentDocumentCount: 0, remainingDocumentCount: 0, usagePercentage: null, limitReached: true })} loading={false} error={undefined} />);
      expect(screen.getByText('Trial limit reached')).toBeInTheDocument();
    });
  });

  describe('accessible progress value', () => {
    it('exposes the usage percentage as an accessible progressbar value', () => {
      render(<UsageIndicator usage={usage({ usagePercentage: 62 })} loading={false} error={undefined} />);
      const bar = screen.getByRole('progressbar', { name: 'Trial document usage' });
      expect(bar).toHaveAttribute('aria-valuenow', '62');
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuemax', '100');
    });
  });
});
