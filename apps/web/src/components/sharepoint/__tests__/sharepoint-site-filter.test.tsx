import { render, screen, fireEvent } from '@testing-library/react';
import { SharePointSiteFilter } from '../sharepoint-site-filter';

describe('SharePointSiteFilter', () => {
  it('calls onChange with "approved" when the Approved button is clicked', () => {
    const onChange = jest.fn();
    render(<SharePointSiteFilter value="all" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approved' }));

    expect(onChange).toHaveBeenCalledWith('approved');
  });

  it('marks the currently-selected filter as pressed', () => {
    render(<SharePointSiteFilter value="pending" onChange={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Pending' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });
});
