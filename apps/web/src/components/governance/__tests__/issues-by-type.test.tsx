import { render, screen } from '@testing-library/react';
import { IssuesByType } from '../issues-by-type';

describe('IssuesByType', () => {
  it('renders an empty state when there are no open issues', () => {
    render(<IssuesByType byType={{}} />);
    expect(screen.getByText('No open governance issues.')).toBeInTheDocument();
  });

  it('renders each issue type with its count, highest count first', () => {
    render(<IssuesByType byType={{ Freshness: 2, Ownership: 5, Metadata: 1 }} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Ownership');
    expect(items[0]).toHaveTextContent('5');
    expect(items[1]).toHaveTextContent('Freshness');
    expect(items[2]).toHaveTextContent('Metadata');
  });
});
