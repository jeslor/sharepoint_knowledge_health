import { render, screen, fireEvent } from '@testing-library/react';
import type { DocumentHealthResponse } from '@sph/types';
import { DocumentHealthTable } from '../document-health-table';

const document: DocumentHealthResponse = {
  documentId: 'doc-1',
  documentName: 'Employee Handbook.docx',
  siteId: 'site-1',
  siteName: 'Team Site',
  owner: 'Alice',
  status: 'Active',
  lastModifiedAt: '2026-06-01T00:00:00.000Z',
  score: 42,
  band: 'RequiresReview',
  issueCount: 2,
  calculatedAt: '2026-07-01T00:00:00.000Z',
  issues: [],
  nextReviewDueAt: null,
  reviewDateHealth: 'Missing',
};

describe('DocumentHealthTable', () => {
  it('renders the empty state when there are no documents', () => {
    render(<DocumentHealthTable documents={[]} sortDir="asc" onToggleScoreSort={jest.fn()} />);

    expect(screen.getByText('No documents match the current filters.')).toBeInTheDocument();
  });

  it('renders a row per document with all required columns', () => {
    render(<DocumentHealthTable documents={[document]} sortDir="asc" onToggleScoreSort={jest.fn()} />);

    expect(screen.getByText('Employee Handbook.docx')).toBeInTheDocument();
    expect(screen.getByText('Team Site')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('42/100')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
  });

  it('shows "Unassigned" when a document has no owner', () => {
    render(<DocumentHealthTable documents={[{ ...document, owner: null }]} sortDir="asc" onToggleScoreSort={jest.fn()} />);

    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  describe('review-date health column (Phase 3A-1)', () => {
    it('shows the review-date status badge and the actual date when one is set', () => {
      render(
        <DocumentHealthTable
          documents={[{ ...document, nextReviewDueAt: '2026-12-01T00:00:00.000Z', reviewDateHealth: 'Healthy' }]}
          sortDir="asc"
          onToggleScoreSort={jest.fn()}
        />,
      );

      expect(screen.getByText('Healthy')).toBeInTheDocument();
      expect(screen.getByText(new Date('2026-12-01T00:00:00.000Z').toLocaleDateString())).toBeInTheDocument();
    });

    it('shows the Overdue badge without a date fallback issue when nextReviewDueAt is in the past', () => {
      render(
        <DocumentHealthTable
          documents={[{ ...document, nextReviewDueAt: '2026-01-01T00:00:00.000Z', reviewDateHealth: 'Overdue' }]}
          sortDir="asc"
          onToggleScoreSort={jest.fn()}
        />,
      );

      expect(screen.getByText('Overdue')).toBeInTheDocument();
    });

    it('shows the Missing badge with no date text when nextReviewDueAt is null', () => {
      render(
        <DocumentHealthTable
          documents={[{ ...document, nextReviewDueAt: null, reviewDateHealth: 'Missing' }]}
          sortDir="asc"
          onToggleScoreSort={jest.fn()}
        />,
      );

      expect(screen.getByText('Missing')).toBeInTheDocument();
    });

    it('shows the Due Soon badge', () => {
      render(
        <DocumentHealthTable
          documents={[{ ...document, nextReviewDueAt: '2026-08-25T00:00:00.000Z', reviewDateHealth: 'DueSoon' }]}
          sortDir="asc"
          onToggleScoreSort={jest.fn()}
        />,
      );

      expect(screen.getByText('Due Soon')).toBeInTheDocument();
    });
  });

  it('calls onToggleScoreSort when the score header is clicked', () => {
    const onToggleScoreSort = jest.fn();
    render(<DocumentHealthTable documents={[document]} sortDir="asc" onToggleScoreSort={onToggleScoreSort} />);

    fireEvent.click(screen.getByText(/Health score/));

    expect(onToggleScoreSort).toHaveBeenCalledTimes(1);
  });
});
