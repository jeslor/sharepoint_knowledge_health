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

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'Open' } });
    expect(onChange).toHaveBeenCalledWith({ status: 'Open' });

    fireEvent.change(screen.getByLabelText(/assigned to/i), { target: { value: 'user-1' } });
    expect(onChange).toHaveBeenCalledWith({ assignedUserId: 'user-1' });
  });

  it('clears the until filter back to undefined', () => {
    const onChange = jest.fn();
    render(<AnalyticsFilters values={{ until: '2026-07-01T00:00:00.000Z' }} assignableUsers={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith({ until: undefined });
  });
});
