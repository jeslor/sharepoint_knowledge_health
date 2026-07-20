import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs } from '../tabs';

const TAB_DEFS = [
  { id: 'details', label: 'Details' },
  { id: 'activity', label: 'Activity' },
  { id: 'history', label: 'History' },
];

describe('Tabs', () => {
  it('renders each tab with proper tablist/tab roles', () => {
    render(<Tabs tabs={TAB_DEFS} activeId="details" onChange={jest.fn()} />);

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
  });

  it('marks the active tab as aria-selected', () => {
    render(<Tabs tabs={TAB_DEFS} activeId="activity" onChange={jest.fn()} />);

    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange when a tab is clicked', () => {
    const onChange = jest.fn();
    render(<Tabs tabs={TAB_DEFS} activeId="details" onChange={onChange} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(onChange).toHaveBeenCalledWith('activity');
  });

  it('moves to the next tab on ArrowRight and wraps around from the last tab', () => {
    const onChange = jest.fn();
    render(<Tabs tabs={TAB_DEFS} activeId="history" onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole('tab', { name: 'History' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('details');
  });

  it('moves to the previous tab on ArrowLeft and wraps around from the first tab', () => {
    const onChange = jest.fn();
    render(<Tabs tabs={TAB_DEFS} activeId="details" onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Details' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('history');
  });
});
