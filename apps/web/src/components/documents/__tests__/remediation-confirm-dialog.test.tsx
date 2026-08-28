import { render, screen, fireEvent } from '@testing-library/react';
import { RemediationConfirmDialog } from '../remediation-confirm-dialog';

describe('RemediationConfirmDialog (P0-6, ADR-0022 Phase 7)', () => {
  it('shows the selected document count', () => {
    render(
      <RemediationConfirmDialog
        open
        onOpenChange={jest.fn()}
        selectedCount={3}
        onConfirm={jest.fn()}
        submitting={false}
        submitError={undefined}
      />,
    );

    expect(screen.getByText(/3 documents will have their next review date set/)).toBeInTheDocument();
  });

  it('uses singular phrasing for exactly one selected document', () => {
    render(
      <RemediationConfirmDialog
        open
        onOpenChange={jest.fn()}
        selectedCount={1}
        onConfirm={jest.fn()}
        submitting={false}
        submitError={undefined}
      />,
    );

    expect(screen.getByText(/1 document will have its next review date set/)).toBeInTheDocument();
  });

  it('Remediate is disabled until a date is entered', () => {
    render(
      <RemediationConfirmDialog
        open
        onOpenChange={jest.fn()}
        selectedCount={2}
        onConfirm={jest.fn()}
        submitting={false}
        submitError={undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Remediate' })).toBeDisabled();
  });

  it('Remediate becomes enabled once a date is entered, and calls onConfirm with an ISO string', () => {
    const onConfirm = jest.fn();
    render(
      <RemediationConfirmDialog
        open
        onOpenChange={jest.fn()}
        selectedCount={2}
        onConfirm={onConfirm}
        submitting={false}
        submitError={undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText('New review due date'), { target: { value: '2026-12-01' } });
    expect(screen.getByRole('button', { name: 'Remediate' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Remediate' }));
    expect(onConfirm).toHaveBeenCalledWith(new Date('2026-12-01').toISOString());
  });

  it('does not call onConfirm when Remediate is clicked with no date entered', () => {
    const onConfirm = jest.fn();
    render(
      <RemediationConfirmDialog
        open
        onOpenChange={jest.fn()}
        selectedCount={2}
        onConfirm={onConfirm}
        submitting={false}
        submitError={undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remediate' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows a loading label and disables both actions while submitting', () => {
    render(
      <RemediationConfirmDialog
        open
        onOpenChange={jest.fn()}
        selectedCount={2}
        onConfirm={jest.fn()}
        submitting
        submitError={undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Remediating…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('Cancel calls onOpenChange(false) without confirming', () => {
    const onOpenChange = jest.fn();
    const onConfirm = jest.fn();
    render(
      <RemediationConfirmDialog
        open
        onOpenChange={onOpenChange}
        selectedCount={2}
        onConfirm={onConfirm}
        submitting={false}
        submitError={undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows the submit error inline when one is present', () => {
    render(
      <RemediationConfirmDialog
        open
        onOpenChange={jest.fn()}
        selectedCount={2}
        onConfirm={jest.fn()}
        submitting={false}
        submitError={new Error('None of the submitted documents are eligible for remediation')}
      />,
    );

    expect(screen.getByText('None of the submitted documents are eligible for remediation')).toBeInTheDocument();
  });

  it('resets the date field back to empty each time the dialog re-opens', () => {
    const { rerender } = render(
      <RemediationConfirmDialog
        open
        onOpenChange={jest.fn()}
        selectedCount={2}
        onConfirm={jest.fn()}
        submitting={false}
        submitError={undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText('New review due date'), { target: { value: '2026-12-01' } });
    expect(screen.getByLabelText('New review due date')).toHaveValue('2026-12-01');

    rerender(
      <RemediationConfirmDialog
        open={false}
        onOpenChange={jest.fn()}
        selectedCount={2}
        onConfirm={jest.fn()}
        submitting={false}
        submitError={undefined}
      />,
    );
    rerender(
      <RemediationConfirmDialog
        open
        onOpenChange={jest.fn()}
        selectedCount={2}
        onConfirm={jest.fn()}
        submitting={false}
        submitError={undefined}
      />,
    );

    expect(screen.getByLabelText('New review due date')).toHaveValue('');
  });
});
