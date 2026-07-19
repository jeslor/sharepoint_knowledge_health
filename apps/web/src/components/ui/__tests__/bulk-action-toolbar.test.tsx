import { render, screen, fireEvent } from '@testing-library/react';
import { BulkActionToolbar } from '../bulk-action-toolbar';

describe('BulkActionToolbar', () => {
  it('renders nothing when no rows are selected', () => {
    const { container } = render(
      <BulkActionToolbar selectedCount={0} onClearSelection={jest.fn()}>
        <button type="button">Assign owner</button>
      </BulkActionToolbar>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the selected count and the caller-supplied actions once rows are selected', () => {
    render(
      <BulkActionToolbar selectedCount={3} onClearSelection={jest.fn()}>
        <button type="button">Assign owner</button>
        <button type="button">Export</button>
      </BulkActionToolbar>,
    );

    expect(screen.getByText(/3 selected/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign owner' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('calls onClearSelection when Clear is clicked', () => {
    const onClearSelection = jest.fn();
    render(
      <BulkActionToolbar selectedCount={2} onClearSelection={onClearSelection}>
        <button type="button">Assign owner</button>
      </BulkActionToolbar>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClearSelection).toHaveBeenCalled();
  });
});
