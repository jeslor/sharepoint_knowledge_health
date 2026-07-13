import { render, screen, fireEvent } from '@testing-library/react';
import { GovernanceIssueFilters } from '../governance-issue-filters';

describe('GovernanceIssueFilters', () => {
  it('calls onChange with the updated status when the status filter changes', () => {
    const onChange = jest.fn();
    render(<GovernanceIssueFilters values={{}} assignableUsers={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'Open' } });

    expect(onChange).toHaveBeenCalledWith({ status: 'Open' });
  });

  it('calls onChange with the updated assignedUserId, listing every assignable user', () => {
    const onChange = jest.fn();
    render(
      <GovernanceIssueFilters
        values={{}}
        assignableUsers={[{ id: 'user-1', displayName: 'Sarah' }]}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('option', { name: 'Sarah' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/assigned to/i), { target: { value: 'user-1' } });

    expect(onChange).toHaveBeenCalledWith({ assignedUserId: 'user-1' });
  });

  it('clears a filter back to undefined when reset to the "All" option', () => {
    const onChange = jest.fn();
    render(<GovernanceIssueFilters values={{ severity: 'RequiresReview' }} assignableUsers={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/severity/i), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith({ severity: undefined });
  });
});
