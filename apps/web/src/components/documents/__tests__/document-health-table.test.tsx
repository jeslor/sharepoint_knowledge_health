import type { ComponentProps } from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
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
  issues: [
    { type: 'ReviewStatus', severity: 'RequiresReview', message: 'Review date is missing.' },
  ],
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

// Responsive fix (mobile audit): below lg, DocumentHealthTable renders a
// card per document instead of the table; at lg and up it renders the
// table — both live in the DOM at once (CSS `hidden`/`lg:block` chooses
// which is visible), since jsdom has no layout engine to evaluate media
// queries. `within(getByRole('table'))` scopes assertions to the desktop
// table specifically, exactly as they behaved before this component grew
// a second, real, CSS-only alternative.
function withinTable() {
  return within(screen.getByRole('table'));
}

describe('DocumentHealthTable', () => {
  it('renders the empty state when there are no documents', () => {
    renderTable({ documents: [] });

    expect(screen.getByText('No documents match the current filters.')).toBeInTheDocument();
  });

  it('renders a row per document with all required columns', () => {
    renderTable();
    const table = withinTable();

    expect(table.getByText('Employee Handbook.docx')).toBeInTheDocument();
    expect(table.getByText('Team Site')).toBeInTheDocument();
    expect(table.getByText('Alice')).toBeInTheDocument();
    expect(table.getByText('42/100')).toBeInTheDocument();
    expect(table.getByText('Active')).toBeInTheDocument();
    expect(table.getByText('2')).toBeInTheDocument();
    expect(table.getByText('Missing')).toBeInTheDocument();
  });

  it('shows "Unassigned" when a document has no owner', () => {
    renderTable({ documents: [{ ...document, owner: null }] });

    expect(withinTable().getByText('Unassigned')).toBeInTheDocument();
  });

  describe('review-date health column (Phase 3A-1)', () => {
    it('shows the review-date status badge and the actual date when one is set', () => {
      renderTable({
        documents: [
          { ...document, nextReviewDueAt: '2026-12-01T00:00:00.000Z', reviewDateHealth: 'Healthy' },
        ],
      });
      const table = withinTable();

      expect(table.getByText('Healthy')).toBeInTheDocument();
      expect(
        table.getByText(new Date('2026-12-01T00:00:00.000Z').toLocaleDateString()),
      ).toBeInTheDocument();
    });

    it('shows the Overdue badge without a date fallback issue when nextReviewDueAt is in the past', () => {
      renderTable({
        documents: [
          { ...document, nextReviewDueAt: '2026-01-01T00:00:00.000Z', reviewDateHealth: 'Overdue' },
        ],
      });

      expect(withinTable().getByText('Overdue')).toBeInTheDocument();
    });

    it('shows the Missing badge with no date text when nextReviewDueAt is null', () => {
      renderTable({
        documents: [{ ...document, nextReviewDueAt: null, reviewDateHealth: 'Missing' }],
      });

      expect(withinTable().getByText('Missing')).toBeInTheDocument();
    });

    it('shows the Due Soon badge', () => {
      renderTable({
        documents: [
          { ...document, nextReviewDueAt: '2026-08-25T00:00:00.000Z', reviewDateHealth: 'DueSoon' },
        ],
      });

      expect(withinTable().getByText('Due Soon')).toBeInTheDocument();
    });
  });

  it('calls onToggleScoreSort when the score header is clicked', () => {
    const onToggleScoreSort = jest.fn();
    renderTable({ onToggleScoreSort });

    fireEvent.click(withinTable().getByText(/Health score/));

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
        isReviewStatusCandidate({
          ...document,
          issues: [{ type: 'Ownership', severity: 'NeedsAttention', message: 'No owner.' }],
        }),
      ).toBe(false);
    });
  });

  describe('row selection (P0-5, ADR-0022 Phase 7)', () => {
    const ineligibleDocument: DocumentHealthResponse = {
      ...document,
      documentId: 'doc-2',
      documentName: 'Old Draft.docx',
      issues: [],
    };

    it('renders an unchecked, enabled checkbox for an eligible, unselected document', () => {
      renderTable();

      const checkbox = withinTable().getByRole('checkbox', {
        name: 'Select Employee Handbook.docx',
      });
      expect(checkbox).not.toBeChecked();
      expect(checkbox).not.toBeDisabled();
    });

    it('renders a checked checkbox for a document already in the selected set', () => {
      renderTable({ selectedDocumentIds: new Set(['doc-1']) });

      expect(
        withinTable().getByRole('checkbox', { name: 'Select Employee Handbook.docx' }),
      ).toBeChecked();
    });

    it('calls onToggleDocument with the documentId when an eligible row checkbox is clicked', () => {
      const onToggleDocument = jest.fn();
      renderTable({ onToggleDocument });

      fireEvent.click(
        withinTable().getByRole('checkbox', { name: 'Select Employee Handbook.docx' }),
      );

      expect(onToggleDocument).toHaveBeenCalledWith('doc-1');
    });

    it('renders a disabled checkbox for a document with no current ReviewStatus issue — never silently selectable', () => {
      const onToggleDocument = jest.fn();
      renderTable({ documents: [document, ineligibleDocument], onToggleDocument });

      const checkbox = withinTable().getByRole('checkbox', { name: 'Select Old Draft.docx' });
      expect(checkbox).toBeDisabled();

      fireEvent.click(checkbox);
      expect(onToggleDocument).not.toHaveBeenCalledWith('doc-2');
    });

    describe('select all', () => {
      it('the header checkbox is unchecked when no eligible documents are selected', () => {
        renderTable({ documents: [document, ineligibleDocument] });

        expect(withinTable().getByRole('checkbox', { name: 'Select all rows' })).not.toBeChecked();
      });

      it('the header checkbox is checked once every eligible document is selected, ignoring ineligible ones', () => {
        renderTable({
          documents: [document, ineligibleDocument],
          selectedDocumentIds: new Set(['doc-1']),
        });

        expect(withinTable().getByRole('checkbox', { name: 'Select all rows' })).toBeChecked();
      });

      it('the header checkbox is disabled when there are no eligible documents at all', () => {
        renderTable({ documents: [ineligibleDocument] });

        expect(withinTable().getByRole('checkbox', { name: 'Select all rows' })).toBeDisabled();
      });

      it('calls onToggleSelectAllEligible when the header checkbox is clicked', () => {
        const onToggleSelectAllEligible = jest.fn();
        renderTable({ onToggleSelectAllEligible });

        fireEvent.click(withinTable().getByRole('checkbox', { name: 'Select all rows' }));

        expect(onToggleSelectAllEligible).toHaveBeenCalledTimes(1);
      });
    });
  });

  // Mobile audit: the card list is a real, separate rendering (not just a
  // CSS reflow of the same markup) — it needs its own coverage rather than
  // assuming the table tests already prove it works.
  describe('mobile card list', () => {
    // The card list is a real <ul> (role="list") — a semantic, not
    // test-only, hook that also scopes queries away from the desktop
    // table's duplicate content (both render in jsdom at once; see the
    // module-level comment on withinTable()).
    function cardListContainer() {
      return within(screen.getByRole('list'));
    }

    it('renders a card with every labeled field for each document', () => {
      renderTable();
      const cards = cardListContainer();

      expect(cards.getByRole('link', { name: 'Employee Handbook.docx' })).toHaveAttribute(
        'href',
        '/dashboard/documents/doc-1',
      );
      expect(cards.getByText('Team Site')).toBeInTheDocument();
      expect(cards.getByText('Alice')).toBeInTheDocument();
      expect(cards.getByText('42/100')).toBeInTheDocument();
      expect(cards.getByText('Active')).toBeInTheDocument();
    });

    // This label text is unique to the mobile view (the desktop table's
    // equivalent header checkbox has no visible text label), so it's safe
    // to query at the document level without scoping.
    it('shows the "select all eligible" control when at least one document is eligible', () => {
      renderTable();
      expect(screen.getByText('Select all eligible for remediation')).toBeInTheDocument();
    });

    it('hides the "select all eligible" control when no document is eligible', () => {
      renderTable({ documents: [{ ...document, issues: [] }] });
      expect(screen.queryByText('Select all eligible for remediation')).not.toBeInTheDocument();
    });

    it('calls onToggleDocument when a card checkbox is clicked', () => {
      const onToggleDocument = jest.fn();
      renderTable({ onToggleDocument });

      fireEvent.click(
        cardListContainer().getByRole('checkbox', { name: 'Select Employee Handbook.docx' }),
      );

      expect(onToggleDocument).toHaveBeenCalledWith('doc-1');
    });
  });
});
