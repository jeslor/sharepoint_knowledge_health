import { render, screen, fireEvent } from '@testing-library/react';
import { UsageLimitDialog } from '../usage-limit-dialog';

describe('UsageLimitDialog (Phase 5)', () => {
  it('is not rendered when closed', () => {
    render(
      <UsageLimitDialog open={false} onOpenChange={jest.fn()} currentDocumentCount={2000} documentLimit={2000} />,
    );
    expect(screen.queryByText('Trial document limit reached')).not.toBeInTheDocument();
  });

  it('shows the exact usage numbers when open, using the backend-provided counts, never a hardcoded limit', () => {
    render(
      <UsageLimitDialog open onOpenChange={jest.fn()} currentDocumentCount={2000} documentLimit={2000} />,
    );

    expect(screen.getByRole('dialog', { name: 'Trial document limit reached' })).toBeInTheDocument();
    expect(screen.getAllByText(/2,000/).length).toBeGreaterThan(0);
  });

  it('never implies existing documents disappear', () => {
    render(
      <UsageLimitDialog open onOpenChange={jest.fn()} currentDocumentCount={2000} documentLimit={2000} />,
    );

    expect(screen.getByText(/remain fully available/i)).toBeInTheDocument();
  });

  it('can be closed via the Close action', () => {
    const onOpenChange = jest.fn();
    render(
      <UsageLimitDialog open onOpenChange={onOpenChange} currentDocumentCount={2000} documentLimit={2000} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders the Upgrade CTA', () => {
    render(
      <UsageLimitDialog open onOpenChange={jest.fn()} currentDocumentCount={2000} documentLimit={2000} />,
    );

    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeInTheDocument();
  });
});
