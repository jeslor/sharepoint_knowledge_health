import { render, screen } from '@testing-library/react';
import HomePage from '../page';

describe('HomePage', () => {
  it('renders the product name', () => {
    render(<HomePage />);
    expect(screen.getByText('SharePoint Knowledge Health')).toBeInTheDocument();
  });
});
