import { render, screen, fireEvent } from '@testing-library/react';
import { AuditLogFilters } from '../audit-log-filters';

describe('AuditLogFilters', () => {
  it('emits the selected action', () => {
    const onChange = jest.fn();
    render(<AuditLogFilters values={{}} onChange={onChange} />);

    fireEvent.click(screen.getByRole('combobox', { name: /action/i }));
    fireEvent.click(screen.getByRole('option', { name: 'user.approved' }));

    expect(onChange).toHaveBeenCalledWith({ action: 'user.approved' });
  });

  it('emits the selected target type', () => {
    const onChange = jest.fn();
    render(<AuditLogFilters values={{}} onChange={onChange} />);

    fireEvent.click(screen.getByRole('combobox', { name: /target type/i }));
    fireEvent.click(screen.getByRole('option', { name: 'ScanJob' }));

    expect(onChange).toHaveBeenCalledWith({ targetType: 'ScanJob' });
  });

  it('clears the action filter when "All" is selected', () => {
    const onChange = jest.fn();
    render(<AuditLogFilters values={{ action: 'user.approved' }} onChange={onChange} />);

    fireEvent.click(screen.getByRole('combobox', { name: /action/i }));
    fireEvent.click(screen.getByRole('option', { name: 'All' }));

    expect(onChange).toHaveBeenCalledWith({ action: undefined });
  });

  it('emits the since date, preserving other filter values', () => {
    const onChange = jest.fn();
    render(<AuditLogFilters values={{ action: 'user.approved' }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/since/i), { target: { value: '2026-08-01' } });

    expect(onChange).toHaveBeenCalledWith({ action: 'user.approved', since: '2026-08-01' });
  });

  it('emits the until date', () => {
    const onChange = jest.fn();
    render(<AuditLogFilters values={{}} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/until/i), { target: { value: '2026-08-06' } });

    expect(onChange).toHaveBeenCalledWith({ until: '2026-08-06' });
  });
});
