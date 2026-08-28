import { render, screen, fireEvent } from '@testing-library/react';
import type { DocumentHealthResponse } from '@sph/types';
import DocumentsPage from '../page';

const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();

const mockUseDocumentHealth = jest.fn();
const mockUseSharePointSites = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock('@/lib/api/hooks/use-document-health', () => ({
  useDocumentHealth: (query: unknown) => mockUseDocumentHealth(query),
}));
jest.mock('@/lib/api/hooks/use-sharepoint-sites', () => ({
  useSharePointSites: () => mockUseSharePointSites(),
}));

const eligibleDocument: DocumentHealthResponse = {
  documentId: 'doc-1',
  documentName: 'Employee Handbook.docx',
  siteId: 'site-1',
  siteName: 'Team Site',
  owner: 'Alice',
  status: 'Active',
  lastModifiedAt: '2026-06-01T00:00:00.000Z',
  score: 42,
  band: 'RequiresReview',
  issueCount: 1,
  calculatedAt: '2026-07-01T00:00:00.000Z',
  issues: [{ type: 'ReviewStatus', severity: 'RequiresReview', message: 'Review date is missing.' }],
  nextReviewDueAt: null,
  reviewDateHealth: 'Missing',
};

const ineligibleDocument: DocumentHealthResponse = {
  ...eligibleDocument,
  documentId: 'doc-2',
  documentName: 'Old Draft.docx',
  issues: [],
};

// P0-5 (ADR-0022 Phase 7): the selection/toolbar wiring this page owns —
// DocumentHealthTable's own tests already cover checkbox rendering/eligibility
// display in isolation, so these prove the page-level state (Set, handlers,
// BulkActionToolbar) actually connects to what the table renders.
describe('DocumentsPage — P0-5 candidate selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockUseDocumentHealth.mockReturnValue({
      data: { data: [eligibleDocument, ineligibleDocument], pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 } },
      loading: false,
      error: undefined,
    });
    mockUseSharePointSites.mockReturnValue({ data: [] });
  });

  it('renders no selection toolbar when nothing is selected', () => {
    render(<DocumentsPage />);

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it('shows an accurate selected count after selecting one document', () => {
    render(<DocumentsPage />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Employee Handbook.docx' }));

    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('deselecting the only selected document hides the toolbar again', () => {
    render(<DocumentsPage />);

    const checkbox = screen.getByRole('checkbox', { name: 'Select Employee Handbook.docx' });
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it('selecting all via the header checkbox only selects the eligible document, never the ineligible one', () => {
    render(<DocumentsPage />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));

    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Employee Handbook.docx' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Old Draft.docx' })).not.toBeChecked();
  });

  it('clicking the header checkbox again deselects the eligible document', () => {
    render(<DocumentsPage />);

    const selectAll = screen.getByRole('checkbox', { name: 'Select all rows' });
    fireEvent.click(selectAll);
    fireEvent.click(selectAll);

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it('clearing the selection via the toolbar\'s Clear button resets the count to zero and hides the toolbar', () => {
    render(<DocumentsPage />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Employee Handbook.docx' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Employee Handbook.docx' })).not.toBeChecked();
  });

  it('exposes the "Remediate review status" action once a document is selected', () => {
    render(<DocumentsPage />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Employee Handbook.docx' }));

    expect(screen.getByRole('button', { name: 'Remediate review status' })).toBeInTheDocument();
  });

  it('preserves a selection made on the current page when the document list is refetched (e.g. a later poll) with the same rows', () => {
    const { rerender } = render(<DocumentsPage />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Employee Handbook.docx' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    // Same underlying data, new array/object identity — simulates a refetch.
    mockUseDocumentHealth.mockReturnValue({
      data: { data: [{ ...eligibleDocument }, { ...ineligibleDocument }], pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 } },
      loading: false,
      error: undefined,
    });
    rerender(<DocumentsPage />);

    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });
});
