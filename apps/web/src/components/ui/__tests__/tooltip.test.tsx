import { render, screen, fireEvent } from '@testing-library/react';
import { Tooltip } from '../tooltip';

describe('Tooltip', () => {
  it('renders the trigger and a tooltip role with the content, hidden by default via opacity', () => {
    render(
      <Tooltip content="Open Microsoft 365 admin center">
        <button type="button">Launcher</button>
      </Tooltip>,
    );

    expect(screen.getByRole('button', { name: 'Launcher' })).toBeInTheDocument();
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Open Microsoft 365 admin center');
    expect(tooltip.className).toContain('opacity-0');
  });

  it('reveals on focus via group-focus-within (keyboard/touch-friendly, not hover-only)', () => {
    render(
      <Tooltip content="Open Microsoft 365 admin center">
        <button type="button">Launcher</button>
      </Tooltip>,
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Launcher' }));
    expect(screen.getByRole('tooltip').className).toContain('group-focus-within:opacity-100');
  });
});
