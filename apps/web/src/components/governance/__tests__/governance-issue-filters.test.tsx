import { render, screen, fireEvent } from '@testing-library/react';
import { GovernanceIssueFilters } from '../governance-issue-filters';

describe('GovernanceIssueFilters', () => {
  it('calls onChange with the updated status when the status filter changes', () => {
    const onChange = jest.fn();
    render(<GovernanceIssueFilters values={{}} assignableUsers={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('combobox', { name: /status/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Open' }));

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

    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }));
    expect(screen.getByRole('option', { name: 'Sarah' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: 'Sarah' }));

    expect(onChange).toHaveBeenCalledWith({ assignedUserId: 'user-1' });
  });

  it('clears a filter back to undefined when reset to the "All" option', () => {
    const onChange = jest.fn();
    render(<GovernanceIssueFilters values={{ severity: 'RequiresReview' }} assignableUsers={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('combobox', { name: /severity/i }));
    fireEvent.click(screen.getByRole('option', { name: 'All' }));

    expect(onChange).toHaveBeenCalledWith({ severity: undefined });
  });

  it('shows the human-readable issue type label ("Review Status"), not the raw enum, and still emits the raw value on selection', () => {
    const onChange = jest.fn();
    render(<GovernanceIssueFilters values={{}} assignableUsers={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('combobox', { name: /issue type/i }));
    expect(screen.getByRole('option', { name: 'Review Status' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'ReviewStatus' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: 'Review Status' }));

    expect(onChange).toHaveBeenCalledWith({ issueType: 'ReviewStatus' });
  });
});
