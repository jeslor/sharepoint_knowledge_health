import { render, screen } from '@testing-library/react';
import { CommandBar } from '../command-bar';

describe('CommandBar', () => {
  it('renders its children in a row', () => {
    render(
      <CommandBar>
        <button type="button">Scan now</button>
        <button type="button">Export</button>
      </CommandBar>,
    );

    expect(screen.getByRole('button', { name: 'Scan now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('renders a slightly elevated, rounded toolbar surface (not a plain underlined row)', () => {
    render(
      <CommandBar>
        <button type="button">Scan now</button>
      </CommandBar>,
    );
    const bar = screen.getByRole('button', { name: 'Scan now' }).parentElement;
    expect(bar?.className).toContain('rounded-xl');
    expect(bar?.className).toContain('border-slate-200/60');
  });
});
