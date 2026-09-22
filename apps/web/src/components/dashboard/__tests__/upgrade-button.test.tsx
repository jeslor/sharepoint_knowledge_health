import { render, screen, fireEvent } from '@testing-library/react';
import { UpgradeButton } from '../upgrade-button';

describe('UpgradeButton (Phase 5 placeholder CTA)', () => {
  it('renders a real, clickable button — not a dead/disabled affordance', () => {
    render(<UpgradeButton />);
    const button = screen.getByRole('button', { name: 'Upgrade' });
    expect(button).toBeEnabled();
  });

  it('never hardcodes fake pricing or a fake payment destination', () => {
    render(<UpgradeButton />);
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/per month|\/mo|checkout/i)).not.toBeInTheDocument();
  });

  it('shows an honest placeholder acknowledgment on click, never pretending billing exists', () => {
    render(<UpgradeButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }));

    expect(screen.getByRole('status')).toHaveTextContent(/aren.t available directly in the app yet/i);
    expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument();
  });
});
