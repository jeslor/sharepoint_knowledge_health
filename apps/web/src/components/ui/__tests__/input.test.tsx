import { render, screen } from '@testing-library/react';
import { Input } from '../input';

describe('Input', () => {
  it('renders a text input with the shared shell styling, matching Button/Select height and radius', () => {
    render(<Input aria-label="Min score" value="10" onChange={() => {}} />);
    const input = screen.getByLabelText('Min score');
    expect(input.className).toContain('rounded-lg');
    expect(input.className).toContain('border-slate-300');
    expect(input.className).toContain('h-10');
  });

  it('passes through native input props', () => {
    render(<Input aria-label="Min score" type="number" min={0} max={100} value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Min score');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '100');
  });

  it('applies a soft red error treatment and aria-invalid when invalid', () => {
    render(<Input aria-label="Email" invalid value="not-an-email" onChange={() => {}} />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.className).toContain('border-red-300');
    expect(input.className).not.toContain('border-slate-300');
  });

  it('does not mark the input invalid by default', () => {
    render(<Input aria-label="Email" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Email');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input.className).toContain('border-slate-300');
  });
});
