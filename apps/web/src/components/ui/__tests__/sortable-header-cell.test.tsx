import type { ComponentProps } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortableHeaderCell } from '../sortable-header-cell';

function renderCell(props: Partial<ComponentProps<typeof SortableHeaderCell>> = {}) {
  return render(
    <table>
      <thead>
        <tr>
          <SortableHeaderCell label="Name" direction={null} onSort={jest.fn()} {...props} />
        </tr>
      </thead>
    </table>,
  );
}

describe('SortableHeaderCell', () => {
  it('renders the label and calls onSort when clicked', () => {
    const onSort = jest.fn();
    renderCell({ onSort });

    fireEvent.click(screen.getByRole('button', { name: /name/i }));
    expect(onSort).toHaveBeenCalled();
  });

  it('sets aria-sort="none" when not the active sort column', () => {
    renderCell({ direction: null });
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none');
  });

  it('sets aria-sort="ascending" when sorted ascending', () => {
    renderCell({ direction: 'asc' });
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('sets aria-sort="descending" when sorted descending', () => {
    renderCell({ direction: 'desc' });
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'descending');
  });
});
