import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ReviewDateLibraryResponse } from '@sph/types';
import { ReviewDateLibraryList } from '../review-date-library-list';
import { useReviewDateEligibility } from '@/lib/api/hooks/use-review-date-eligibility';
import { useConfirmReviewDateMapping } from '@/lib/api/hooks/use-confirm-review-date-mapping';

jest.mock('@/lib/api/hooks/use-review-date-eligibility');
jest.mock('@/lib/api/hooks/use-confirm-review-date-mapping');

const mockedUseEligibility = useReviewDateEligibility as jest.MockedFunction<typeof useReviewDateEligibility>;
const mockedUseConfirm = useConfirmReviewDateMapping as jest.MockedFunction<typeof useConfirmReviewDateMapping>;

function library(overrides: Partial<ReviewDateLibraryResponse> = {}): ReviewDateLibraryResponse {
  return { graphListId: 'list-1', driveId: 'drive-1', name: 'HR Knowledge', mapping: null, ...overrides };
}

const activeMapping = {
  id: 'mapping-1',
  siteId: 'site-1',
  graphListId: 'list-1',
  columnDefinitionId: 'col-1',
  columnDisplayName: 'Review Date',
  status: 'Active',
  confirmedByUserId: 'user-1',
  confirmedByDisplayName: 'Alice Admin',
  confirmedAt: '2026-08-12T00:00:00.000Z',
};

describe('ReviewDateLibraryList', () => {
  const check = jest.fn();
  const confirm = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseEligibility.mockReturnValue({ result: undefined, checking: false, checkError: undefined, check });
    mockedUseConfirm.mockReturnValue({ confirm, confirming: false, confirmError: undefined });
  });

  it('renders an empty state when the site has no document libraries', () => {
    render(<ReviewDateLibraryList siteId="site-1" libraries={[]} canManage onMappingChanged={jest.fn()} />);

    expect(screen.getByText('This site has no document libraries.')).toBeInTheDocument();
  });

  it('NOT CHECKED: shows the library name, "Not checked" badge, and a "Check for a review-date column" action', () => {
    render(<ReviewDateLibraryList siteId="site-1" libraries={[library()]} canManage onMappingChanged={jest.fn()} />);

    expect(screen.getByText('Library: HR Knowledge')).toBeInTheDocument();
    expect(screen.getByText('Not checked')).toBeInTheDocument();
    expect(screen.getByText('Review-date column has not been checked yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check for a review-date column' })).toBeInTheDocument();
  });

  it('clicking "Check for a review-date column" calls check()', () => {
    render(<ReviewDateLibraryList siteId="site-1" libraries={[library()]} canManage onMappingChanged={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Check for a review-date column' }));

    expect(check).toHaveBeenCalled();
  });

  it('CHECKED, NO ELIGIBLE COLUMN: shows the no-column message and self-service SharePoint guidance, no Confirm button', () => {
    mockedUseEligibility.mockReturnValue({ result: { status: 'NoEligibleColumn' }, checking: false, checkError: undefined, check });

    render(<ReviewDateLibraryList siteId="site-1" libraries={[library()]} canManage onMappingChanged={jest.fn()} />);

    expect(screen.getByText('Review date column not configured')).toBeInTheDocument();
    expect(screen.getByText(/create a Date and Time column in SharePoint/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('CHECKED, NO ELIGIBLE COLUMN: offers a discoverable, structured how-to for creating the column (Phase 3A-1)', () => {
    mockedUseEligibility.mockReturnValue({ result: { status: 'NoEligibleColumn' }, checking: false, checkError: undefined, check });

    render(<ReviewDateLibraryList siteId="site-1" libraries={[library()]} canManage onMappingChanged={jest.fn()} />);

    expect(screen.getByText('How do I create this column?')).toBeInTheDocument();
    expect(screen.getByText(/Select "Add column"/)).toBeInTheDocument();
    expect(screen.getByText(/Review Due Date/)).toBeInTheDocument();
  });

  it('CHECKED, ONE CANDIDATE: shows an "Action needed" badge and a Confirm button that opens the dialog', () => {
    mockedUseEligibility.mockReturnValue({
      result: { status: 'SingleEligibleColumn', column: { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', confidence: 'high' } },
      checking: false,
      checkError: undefined,
      check,
    });

    render(<ReviewDateLibraryList siteId="site-1" libraries={[library()]} canManage onMappingChanged={jest.fn()} />);

    expect(screen.getByText('Action needed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('CHECKED, MULTIPLE CANDIDATES: opens the dialog with a required selection, never pre-selected', () => {
    mockedUseEligibility.mockReturnValue({
      result: {
        status: 'MultipleEligibleColumns',
        columns: [
          { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', confidence: 'high' },
          { id: 'col-2', name: 'ExpiryDate', displayName: 'Expiry Date', confidence: 'medium' },
        ],
      },
      checking: false,
      checkError: undefined,
      check,
    });

    render(<ReviewDateLibraryList siteId="site-1" libraries={[library()]} canManage onMappingChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByRole('dialog').querySelector('button[disabled]')).not.toBeNull();
  });

  it('ACTIVE: states SharePoint is the source of truth and shows the confirmed column and confirmer', () => {
    render(<ReviewDateLibraryList siteId="site-1" libraries={[library({ mapping: activeMapping })]} canManage onMappingChanged={jest.fn()} />);

    expect(screen.getByText('SharePoint review dates enabled')).toBeInTheDocument();
    expect(screen.getByText("SharePoint is now the source of truth for this library's review dates.")).toBeInTheDocument();
    expect(screen.getByText('Review date column: Review Date · Confirmed by Alice Admin')).toBeInTheDocument();
    // No "check" or "confirm" action for an already-Active mapping.
    expect(screen.queryByRole('button', { name: 'Check for a review-date column' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('STALE: explains sync stopped and offers "Choose replacement column"', () => {
    const staleMapping = { ...activeMapping, status: 'Stale' };
    render(<ReviewDateLibraryList siteId="site-1" libraries={[library({ mapping: staleMapping })]} canManage onMappingChanged={jest.fn()} />);

    expect(screen.getByText('SharePoint column unavailable')).toBeInTheDocument();
    expect(screen.getByText(/no longer available/)).toBeInTheDocument();
    expect(screen.getByText(/stopped synchronizing/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose replacement column' })).toBeInTheDocument();
  });

  it('STALE: "Choose replacement column" triggers a fresh eligibility check, never reuses old candidates', () => {
    const staleMapping = { ...activeMapping, status: 'Stale' };
    render(<ReviewDateLibraryList siteId="site-1" libraries={[library({ mapping: staleMapping })]} canManage onMappingChanged={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose replacement column' }));

    expect(check).toHaveBeenCalled();
  });

  it('STALE: once a fresh eligibility check finds a candidate after "Choose replacement", the row becomes confirmable, not stuck on Stale', () => {
    const staleMapping = { ...activeMapping, status: 'Stale' };
    mockedUseEligibility.mockReturnValue({
      result: { status: 'SingleEligibleColumn', column: { id: 'col-2', name: 'NextReview', displayName: 'Next Review', confidence: 'high' } },
      checking: false,
      checkError: undefined,
      check,
    });

    render(<ReviewDateLibraryList siteId="site-1" libraries={[library({ mapping: staleMapping })]} canManage onMappingChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose replacement column' }));

    expect(screen.getByText('Action needed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('does not render any action buttons when canManage is false — read-only for a Member', () => {
    render(<ReviewDateLibraryList siteId="site-1" libraries={[library()]} canManage={false} onMappingChanged={jest.fn()} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // The status is still visible — this is a read-viewable page, not an Admin-only block.
    expect(screen.getByText('Not checked')).toBeInTheDocument();
  });

  it('calls onMappingChanged after a successful confirm, and closes the dialog', async () => {
    const onMappingChanged = jest.fn();
    confirm.mockResolvedValue(activeMapping);
    mockedUseEligibility.mockReturnValue({
      result: { status: 'SingleEligibleColumn', column: { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', confidence: 'high' } },
      checking: false,
      checkError: undefined,
      check,
    });

    render(<ReviewDateLibraryList siteId="site-1" libraries={[library()]} canManage onMappingChanged={onMappingChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));

    expect(confirm).toHaveBeenCalledWith('site-1', 'list-1', 'col-1');
  });
});
