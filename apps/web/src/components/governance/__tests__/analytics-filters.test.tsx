import { render, screen, fireEvent } from '@testing-library/react';
import { AnalyticsFilters } from '../analytics-filters';

describe('AnalyticsFilters', () => {
  it('calls onChange with an ISO since value when the From date changes', () => {
    const onChange = jest.fn();
    render(<AnalyticsFilters values={{}} assignableUsers={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/from/i), { target: { value: '2026-06-01' } });

    expect(onChange).toHaveBeenCalledWith({ since: new Date('2026-06-01').toISOString() });
  });

  it('calls onChange with status/severity/issueType/assignedUserId updates', () => {
    const onChange = jest.fn();
    render(
      <AnalyticsFilters
        values={{}}
        assignableUsers={[{ id: 'user-1', displayName: 'Sarah' }]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('combobox', { name: /status/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Open' }));
    expect(onChange).toHaveBeenCalledWith({ status: 'Open' });

    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Sarah' }));
    expect(onChange).toHaveBeenCalledWith({ assignedUserId: 'user-1' });
  });

  it('clears the until filter back to undefined', () => {
    const onChange = jest.fn();
    render(<AnalyticsFilters values={{ until: '2026-07-01T00:00:00.000Z' }} assignableUsers={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith({ until: undefined });
  });

  it('clears the status filter back to undefined when reset to the "All" option', () => {
    const onChange = jest.fn();
    render(<AnalyticsFilters values={{ status: 'Open' }} assignableUsers={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('combobox', { name: /status/i }));
    fireEvent.click(screen.getByRole('option', { name: 'All' }));

    expect(onChange).toHaveBeenCalledWith({ status: undefined });
  });
});
