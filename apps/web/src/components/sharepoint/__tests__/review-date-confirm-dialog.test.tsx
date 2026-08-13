import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewDateConfirmDialog } from '../review-date-confirm-dialog';
import { CONFIRM_OVERWRITE_WARNING } from '../review-date-status';

describe('ReviewDateConfirmDialog — single candidate', () => {
  const singleEligibility = {
    status: 'SingleEligibleColumn' as const,
    column: { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', confidence: 'high' as const },
  };

  it('shows the overwrite warning directly in the dialog body, not a tooltip', () => {
    render(
      <ReviewDateConfirmDialog
        open
        onOpenChange={jest.fn()}
        eligibility={singleEligibility}
        onConfirm={jest.fn()}
        confirming={false}
        confirmError={undefined}
      />,
    );

    expect(screen.getByText(CONFIRM_OVERWRITE_WARNING)).toBeInTheDocument();
  });

  it('Confirm is enabled immediately for a single candidate — nothing to select', () => {
    render(
      <ReviewDateConfirmDialog
        open
        onOpenChange={jest.fn()}
        eligibility={singleEligibility}
        onConfirm={jest.fn()}
        confirming={false}
        confirmError={undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Confirm' })).not.toBeDisabled();
  });

  it('calls onConfirm with the single candidate id when Confirm is clicked', () => {
    const onConfirm = jest.fn();
    render(
      <ReviewDateConfirmDialog
        open
        onOpenChange={jest.fn()}
        eligibility={singleEligibility}
        onConfirm={onConfirm}
        confirming={false}
        confirmError={undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledWith('col-1');
  });

  it('shows the confirm error inline when one is present', () => {
    render(
      <ReviewDateConfirmDialog
        open
        onOpenChange={jest.fn()}
        eligibility={singleEligibility}
        onConfirm={jest.fn()}
        confirming={false}
        confirmError={new Error('Multiple candidate date columns were found')}
      />,
    );

    expect(screen.getByText('Multiple candidate date columns were found')).toBeInTheDocument();
  });
});

describe('ReviewDateConfirmDialog — multiple candidates', () => {
  const multipleEligibility = {
    status: 'MultipleEligibleColumns' as const,
    columns: [
      { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', confidence: 'high' as const },
      { id: 'col-2', name: 'ExpiryDate', displayName: 'Expiry Date', confidence: 'medium' as const },
    ],
  };

  it('Confirm is disabled until a candidate is explicitly selected — never auto-picked', () => {
    render(
      <ReviewDateConfirmDialog
        open
        onOpenChange={jest.fn()}
        eligibility={multipleEligibility}
        onConfirm={jest.fn()}
        confirming={false}
        confirmError={undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('Confirm becomes enabled once a candidate is selected, and calls onConfirm with that id', () => {
    const onConfirm = jest.fn();
    render(
      <ReviewDateConfirmDialog
        open
        onOpenChange={jest.fn()}
        eligibility={multipleEligibility}
        onConfirm={onConfirm}
        confirming={false}
        confirmError={undefined}
      />,
    );

    fireEvent.click(screen.getByText('Expiry Date'));
    expect(screen.getByRole('button', { name: 'Confirm' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith('col-2');
  });

  it('also shows the overwrite warning for the multiple-candidate flow', () => {
    render(
      <ReviewDateConfirmDialog
        open
        onOpenChange={jest.fn()}
        eligibility={multipleEligibility}
        onConfirm={jest.fn()}
        confirming={false}
        confirmError={undefined}
      />,
    );

    expect(screen.getByText(CONFIRM_OVERWRITE_WARNING)).toBeInTheDocument();
  });

  it('Cancel calls onOpenChange(false) without confirming', () => {
    const onOpenChange = jest.fn();
    const onConfirm = jest.fn();
    render(
      <ReviewDateConfirmDialog
        open
        onOpenChange={onOpenChange}
        eligibility={multipleEligibility}
        onConfirm={onConfirm}
        confirming={false}
        confirmError={undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
