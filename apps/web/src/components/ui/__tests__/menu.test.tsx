import { render, screen, fireEvent } from '@testing-library/react';
import { MoreHorizontalRegular } from '@fluentui/react-icons';
import { Menu } from '../menu';

describe('Menu', () => {
  it('does not show items until the trigger is activated', () => {
    render(<Menu trigger={<button type="button">Actions</button>} items={[{ label: 'Rename', onClick: jest.fn() }]} />);
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
  });

  it('shows items after clicking the trigger, and calls the item onClick when selected', () => {
    const onClick = jest.fn();
    render(<Menu trigger={<button type="button">Actions</button>} items={[{ label: 'Rename', onClick }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    const item = screen.getByRole('menuitem', { name: 'Rename' });
    expect(item).toBeInTheDocument();

    fireEvent.click(item);
    expect(onClick).toHaveBeenCalled();
  });

  it('serves the overflow-menu use case (icon-only trigger)', () => {
    render(
      <Menu
        trigger={
          <button type="button" aria-label="More actions">
            <MoreHorizontalRegular />
          </button>
        }
        items={[{ label: 'Delete', onClick: jest.fn() }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });
});
