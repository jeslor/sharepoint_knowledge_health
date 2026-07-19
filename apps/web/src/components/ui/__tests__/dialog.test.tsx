import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog } from '../dialog';

describe('Dialog', () => {
  it('is not rendered when closed', () => {
    render(
      <Dialog open={false} onOpenChange={jest.fn()} title="Confirm">
        Body content
      </Dialog>,
    );
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
  });

  it('renders the title, body, and optional actions when open', () => {
    render(
      <Dialog open onOpenChange={jest.fn()} title="Confirm" actions={<button type="button">OK</button>}>
        Body content
      </Dialog>,
    );

    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByText('Body content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
  });

  it('calls onOpenChange(false) when Escape is pressed (Fluent-provided dismissal)', () => {
    const onOpenChange = jest.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Confirm">
        Body content
      </Dialog>,
    );

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
