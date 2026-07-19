import { render, screen, fireEvent } from '@testing-library/react';
import { Callout } from '../callout';

describe('Callout', () => {
  it('does not show its content until the trigger is clicked', () => {
    render(
      <Callout trigger={<button type="button">Info</button>}>
        <p>Freshness measures how recently a document was modified.</p>
      </Callout>,
    );
    expect(screen.queryByText('Freshness measures how recently a document was modified.')).not.toBeInTheDocument();
  });

  it('shows its content after the trigger is clicked (click-triggered, not hover-only)', () => {
    render(
      <Callout trigger={<button type="button">Info</button>}>
        <p>Freshness measures how recently a document was modified.</p>
      </Callout>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Info' }));
    expect(screen.getByText('Freshness measures how recently a document was modified.')).toBeInTheDocument();
  });
});
