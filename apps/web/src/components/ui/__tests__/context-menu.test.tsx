import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu } from '../context-menu';

describe('ContextMenu', () => {
  it('does not show items until the trigger is right-clicked', () => {
    render(
      <ContextMenu trigger={<div>Row content</div>} items={[{ label: 'Delete', onClick: jest.fn() }]} />,
    );
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('shows items after a right-click (contextmenu event) on the trigger, and calls onClick when selected', () => {
    const onClick = jest.fn();
    render(<ContextMenu trigger={<div>Row content</div>} items={[{ label: 'Delete', onClick }]} />);

    fireEvent.contextMenu(screen.getByText('Row content'));
    const item = screen.getByRole('menuitem', { name: 'Delete' });
    expect(item).toBeInTheDocument();

    fireEvent.click(item);
    expect(onClick).toHaveBeenCalled();
  });
});
