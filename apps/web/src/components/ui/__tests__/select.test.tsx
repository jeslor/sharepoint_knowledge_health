import { render, screen, fireEvent } from '@testing-library/react';
import { Select } from '../select';

const SEVERITY_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'RequiresReview', label: 'Critical' },
];

describe('Select', () => {
  it('renders the selected option label as its displayed value', () => {
    render(<Select aria-label="Severity" value="RequiresReview" onChange={() => {}} options={SEVERITY_OPTIONS} />);
    expect(screen.getByRole('combobox', { name: 'Severity' })).toHaveTextContent('Critical');
  });

  it('opens a floating listbox with the options on click, and calls onChange with the option value when one is selected', () => {
    const onChange = jest.fn();
    render(<Select aria-label="Severity" value="" onChange={onChange} options={SEVERITY_OPTIONS} />);

    fireEvent.click(screen.getByRole('combobox', { name: 'Severity' }));
    fireEvent.click(screen.getByRole('option', { name: 'Critical' }));

    expect(onChange).toHaveBeenCalledWith('RequiresReview');
  });

  it('does not show the option list until the trigger is activated', () => {
    render(<Select aria-label="Severity" value="" onChange={() => {}} options={SEVERITY_OPTIONS} />);
    expect(screen.queryByRole('option', { name: 'Critical' })).not.toBeInTheDocument();
  });

  it('is disabled when the disabled prop is set', () => {
    render(<Select aria-label="Severity" value="" onChange={() => {}} options={SEVERITY_OPTIONS} disabled />);
    expect(screen.getByRole('combobox', { name: 'Severity' })).toBeDisabled();
  });

  it('renders the open popup as a soft, rounded floating surface (not a harsh-bordered browser control)', () => {
    render(<Select aria-label="Severity" value="" onChange={() => {}} options={SEVERITY_OPTIONS} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Severity' }));
    const listbox = screen.getByRole('listbox');
    expect(listbox.className).toContain('rounded-xl');
    expect(listbox.className).toContain('shadow-md');
    expect(listbox.className).toContain('border-slate-200/60');
  });
});
