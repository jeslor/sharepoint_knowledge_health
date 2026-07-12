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
  });

  it('shows "Unassigned" when a document has no owner', () => {
    render(<DocumentHealthTable documents={[{ ...document, owner: null }]} sortDir="asc" onToggleScoreSort={jest.fn()} />);

    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('calls onToggleScoreSort when the score header is clicked', () => {
    const onToggleScoreSort = jest.fn();
    render(<DocumentHealthTable documents={[document]} sortDir="asc" onToggleScoreSort={onToggleScoreSort} />);

    fireEvent.click(screen.getByText(/Health score/));

    expect(onToggleScoreSort).toHaveBeenCalledTimes(1);
  });
});
