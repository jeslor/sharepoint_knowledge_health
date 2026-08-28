import type { ComponentProps } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DocumentHealthResponse } from '@sph/types';
import { DocumentHealthTable, isReviewStatusCandidate } from '../document-health-table';

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
  issues: [{ type: 'ReviewStatus', severity: 'RequiresReview', message: 'Review date is missing.' }],
  nextReviewDueAt: null,
  reviewDateHealth: 'Missing',
};

// Every existing test predates P0-5's selection props — a small render
// helper keeps those tests unchanged while giving the new selection tests a
// place to override just the props they care about.
function renderTable(overrides: Partial<ComponentProps<typeof DocumentHealthTable>> = {}) {
  const props = {
    documents: [document],
    sortDir: 'asc' as const,
    onToggleScoreSort: jest.fn(),
    selectedDocumentIds: new Set<string>(),
    onToggleDocument: jest.fn(),
    onToggleSelectAllEligible: jest.fn(),
    ...overrides,
  };
  render(<DocumentHealthTable {...props} />);
  return props;
}

describe('DocumentHealthTable', () => {
  it('renders the empty state when there are no documents', () => {
    renderTable({ documents: [] });

    expect(screen.getByText('No documents match the current filters.')).toBeInTheDocument();
  });

  it('renders a row per document with all required columns', () => {
    renderTable();

    expect(screen.getByText('Employee Handbook.docx')).toBeInTheDocument();
    expect(screen.getByText('Team Site')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('42/100')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
  });

  it('shows "Unassigned" when a document has no owner', () => {
    renderTable({ documents: [{ ...document, owner: null }] });

    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  describe('review-date health column (Phase 3A-1)', () => {
    it('shows the review-date status badge and the actual date when one is set', () => {
      renderTable({ documents: [{ ...document, nextReviewDueAt: '2026-12-01T00:00:00.000Z', reviewDateHealth: 'Healthy' }] });

      expect(screen.getByText('Healthy')).toBeInTheDocument();
      expect(screen.getByText(new Date('2026-12-01T00:00:00.000Z').toLocaleDateString())).toBeInTheDocument();
    });

    it('shows the Overdue badge without a date fallback issue when nextReviewDueAt is in the past', () => {
      renderTable({ documents: [{ ...document, nextReviewDueAt: '2026-01-01T00:00:00.000Z', reviewDateHealth: 'Overdue' }] });

      expect(screen.getByText('Overdue')).toBeInTheDocument();
    });

    it('shows the Missing badge with no date text when nextReviewDueAt is null', () => {
      renderTable({ documents: [{ ...document, nextReviewDueAt: null, reviewDateHealth: 'Missing' }] });

      expect(screen.getByText('Missing')).toBeInTheDocument();
    });

    it('shows the Due Soon badge', () => {
      renderTable({ documents: [{ ...document, nextReviewDueAt: '2026-08-25T00:00:00.000Z', reviewDateHealth: 'DueSoon' }] });

      expect(screen.getByText('Due Soon')).toBeInTheDocument();
    });
  });

  it('calls onToggleScoreSort when the score header is clicked', () => {
    const onToggleScoreSort = jest.fn();
    renderTable({ onToggleScoreSort });

    fireEvent.click(screen.getByText(/Health score/));

    expect(onToggleScoreSort).toHaveBeenCalledTimes(1);
  });

  describe('isReviewStatusCandidate (P0-5)', () => {
    it('is a candidate when a current ReviewStatus HealthIssue is present', () => {
      expect(isReviewStatusCandidate(document)).toBe(true);
    });

    it('is not a candidate when no issues are present', () => {
      expect(isReviewStatusCandidate({ ...document, issues: [] })).toBe(false);
    });

    it('is not a candidate when only other issue types are present', () => {
      expect(
        isReviewStatusCandidate({ ...document, issues: [{ type: 'Ownership', severity: 'NeedsAttention', message: 'No owner.' }] }),
      ).toBe(false);
    });
  });

  describe('row selection (P0-5, ADR-0022 Phase 7)', () => {
    const ineligibleDocument: DocumentHealthResponse = { ...document, documentId: 'doc-2', documentName: 'Old Draft.docx', issues: [] };

    it('renders an unchecked, enabled checkbox for an eligible, unselected document', () => {
      renderTable();

      const checkbox = screen.getByRole('checkbox', { name: 'Select Employee Handbook.docx' });
      expect(checkbox).not.toBeChecked();
      expect(checkbox).not.toBeDisabled();
    });

    it('renders a checked checkbox for a document already in the selected set', () => {
      renderTable({ selectedDocumentIds: new Set(['doc-1']) });

      expect(screen.getByRole('checkbox', { name: 'Select Employee Handbook.docx' })).toBeChecked();
    });

    it('calls onToggleDocument with the documentId when an eligible row checkbox is clicked', () => {
      const onToggleDocument = jest.fn();
      renderTable({ onToggleDocument });

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Employee Handbook.docx' }));

      expect(onToggleDocument).toHaveBeenCalledWith('doc-1');
    });

    it('renders a disabled checkbox for a document with no current ReviewStatus issue — never silently selectable', () => {
      const onToggleDocument = jest.fn();
      renderTable({ documents: [document, ineligibleDocument], onToggleDocument });

      const checkbox = screen.getByRole('checkbox', { name: 'Select Old Draft.docx' });
      expect(checkbox).toBeDisabled();

      fireEvent.click(checkbox);
      expect(onToggleDocument).not.toHaveBeenCalledWith('doc-2');
    });

    describe('select all', () => {
      it('the header checkbox is unchecked when no eligible documents are selected', () => {
        renderTable({ documents: [document, ineligibleDocument] });

        expect(screen.getByRole('checkbox', { name: 'Select all rows' })).not.toBeChecked();
      });

      it('the header checkbox is checked once every eligible document is selected, ignoring ineligible ones', () => {
        renderTable({ documents: [document, ineligibleDocument], selectedDocumentIds: new Set(['doc-1']) });

        expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toBeChecked();
      });

      it('the header checkbox is disabled when there are no eligible documents at all', () => {
        renderTable({ documents: [ineligibleDocument] });

        expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toBeDisabled();
      });

      it('calls onToggleSelectAllEligible when the header checkbox is clicked', () => {
        const onToggleSelectAllEligible = jest.fn();
        renderTable({ onToggleSelectAllEligible });

        fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));

        expect(onToggleSelectAllEligible).toHaveBeenCalledTimes(1);
      });
    });
  });
});
