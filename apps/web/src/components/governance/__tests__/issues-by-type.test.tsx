import { render, screen, fireEvent } from '@testing-library/react';
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

  it('renders plain, non-interactive text rows when onSelect is not provided (existing org-wide card, unaffected)', () => {
    render(<IssuesByType byType={{ Freshness: 2 }} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  describe('Phase 1 work-queue summary strip (onSelect provided)', () => {
    it('renders each row as a clickable button showing the human-readable label', () => {
      render(<IssuesByType byType={{ ReviewStatus: 8 }} onSelect={jest.fn()} />);

      const button = screen.getByRole('button', { name: /review status/i });
      expect(button).toHaveTextContent('8');
    });

    it('calls onSelect with the RAW issueType value, not the display label', () => {
      const onSelect = jest.fn();
      render(<IssuesByType byType={{ ReviewStatus: 8 }} onSelect={onSelect} />);

      fireEvent.click(screen.getByRole('button', { name: /review status/i }));

      expect(onSelect).toHaveBeenCalledWith('ReviewStatus');
    });

    it('still renders an empty state when the current view has zero issues', () => {
      render(<IssuesByType byType={{}} onSelect={jest.fn()} />);
      expect(screen.getByText('No open governance issues.')).toBeInTheDocument();
    });
  });
});
