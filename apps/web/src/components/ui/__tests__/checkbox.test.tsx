import { render, screen, fireEvent } from '@testing-library/react';
import { Checkbox } from '../checkbox';

describe('Checkbox', () => {
  it('renders as a checkbox input with the required accessible name', () => {
    render(<Checkbox aria-label="Select Handbook.docx" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Select Handbook.docx' })).toBeInTheDocument();
  });

  it('reflects checked state and calls onChange when toggled', () => {
    const onChange = jest.fn();
    render(<Checkbox aria-label="Select all rows" checked={false} onChange={onChange} />);

    const checkbox = screen.getByRole('checkbox', { name: 'Select all rows' });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalled();
  });
});
