import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DocumentHealthResponse } from '@sph/types';
import DocumentsPage from '../page';

const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();

const mockUseDocumentHealth = jest.fn();
const mockUseSharePointSites = jest.fn();
const mockUseCreateRemediationJob = jest.fn();

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
jest.mock('@/lib/api/hooks/use-create-remediation-job', () => ({
  useCreateRemediationJob: () => mockUseCreateRemediationJob(),
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
    mockUseCreateRemediationJob.mockReturnValue({ submit: jest.fn(), submitting: false, submitError: undefined });
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

// P0-6 (ADR-0022 Phase 7): the confirmation dialog + submission flow this
// page owns. RemediationConfirmDialog's own tests already cover its pure
// rendering/validation behavior in isolation, so these prove the page-level
// wiring — the exact payload assembled from selectedDocumentIds, and what
// happens to the dialog/selection/toast on success vs. failure.
describe('DocumentsPage — P0-6 remediation confirmation + submission', () => {
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

  function selectEligibleDocumentAndOpenDialog(): void {
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Employee Handbook.docx' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remediate review status' }));
  }

  it('clicking "Remediate review status" opens the confirmation dialog', () => {
    mockUseCreateRemediationJob.mockReturnValue({ submit: jest.fn(), submitting: false, submitError: undefined });
    render(<DocumentsPage />);

    selectEligibleDocumentAndOpenDialog();

    expect(screen.getByText(/will have its next review date set/)).toBeInTheDocument();
  });

  it('the dialog displays the correct selected-document count', () => {
    mockUseCreateRemediationJob.mockReturnValue({ submit: jest.fn(), submitting: false, submitError: undefined });
    render(<DocumentsPage />);

    selectEligibleDocumentAndOpenDialog();

    expect(screen.getByText(/^1 document will have/)).toBeInTheDocument();
  });

  it('submits the fixed ReviewStatus issue type, the selected document ids, and the chosen date', async () => {
    const submit = jest.fn().mockResolvedValue({ remediationJobId: 'job-1', totalCount: 1, ineligibleDocumentIds: [] });
    mockUseCreateRemediationJob.mockReturnValue({ submit, submitting: false, submitError: undefined });
    render(<DocumentsPage />);

    selectEligibleDocumentAndOpenDialog();
    fireEvent.change(screen.getByLabelText('New review due date'), { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remediate' }));

    await screen.findByText('Remediation started for 1 document.');

    expect(submit).toHaveBeenCalledWith({
      issueType: 'ReviewStatus',
      documentIds: ['doc-1'],
      nextReviewDueAt: new Date('2026-12-01').toISOString(),
    });
  });

  it('shows a loading/disabled state on the submit button while submitting', () => {
    mockUseCreateRemediationJob.mockReturnValue({ submit: jest.fn(), submitting: true, submitError: undefined });
    render(<DocumentsPage />);

    selectEligibleDocumentAndOpenDialog();

    expect(screen.getByRole('button', { name: 'Remediating…' })).toBeDisabled();
  });

  it('closes the dialog and clears the selection after a successful submission', async () => {
    const submit = jest.fn().mockResolvedValue({ remediationJobId: 'job-1', totalCount: 1, ineligibleDocumentIds: [] });
    mockUseCreateRemediationJob.mockReturnValue({ submit, submitting: false, submitError: undefined });
    render(<DocumentsPage />);

    selectEligibleDocumentAndOpenDialog();
    fireEvent.change(screen.getByLabelText('New review due date'), { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remediate' }));

    await screen.findByText('Remediation started for 1 document.');

    expect(screen.queryByText(/will have its next review date set/)).not.toBeInTheDocument();
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    // Fluent's Dialog keeps the rest of the page aria-hidden (its focus-trap
    // guard) until its close transition's cleanup runs, which lags behind
    // both the dialog's own removal from the DOM and the state update
    // above by a further tick — waitFor (not a plain assertion) is what
    // actually tolerates that, retrying until the checkbox is genuinely
    // accessible again.
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select Employee Handbook.docx' })).not.toBeChecked());
  });

  it('shows the server error inline and keeps the selection intact when submission fails — never a false success', async () => {
    const submit = jest.fn().mockResolvedValue(undefined);
    mockUseCreateRemediationJob.mockReturnValue({
      submit,
      submitting: false,
      submitError: new Error('None of the submitted documents are eligible for remediation'),
    });
    render(<DocumentsPage />);

    selectEligibleDocumentAndOpenDialog();
    fireEvent.change(screen.getByLabelText('New review due date'), { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remediate' }));

    await screen.findByText('None of the submitted documents are eligible for remediation');

    expect(screen.getByText(/will have its next review date set/)).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.queryByText('Remediation started for 1 document.')).not.toBeInTheDocument();
  });
});
