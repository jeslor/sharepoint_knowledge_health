import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ClassificationLibraryResponse } from '@sph/types';
import { ClassificationFieldManager } from '../classification-field-manager';
import { useClassificationCandidates } from '@/lib/api/hooks/use-classification-candidates';
import { useClassificationFieldMutations } from '@/lib/api/hooks/use-classification-field-mutations';

jest.mock('@/lib/api/hooks/use-classification-candidates');
jest.mock('@/lib/api/hooks/use-classification-field-mutations');

const mockedUseCandidates = useClassificationCandidates as jest.MockedFunction<typeof useClassificationCandidates>;
const mockedUseMutations = useClassificationFieldMutations as jest.MockedFunction<typeof useClassificationFieldMutations>;

function library(overrides: Partial<ClassificationLibraryResponse> = {}): ClassificationLibraryResponse {
  return { graphListId: 'list-1', driveId: 'drive-1', name: 'HR Knowledge', fields: [], ...overrides };
}

const activeField = {
  id: 'field-1',
  siteId: 'site-1',
  graphListId: 'list-1',
  columnDefinitionId: 'col-dept',
  columnDisplayName: 'Department',
  status: 'Active',
  staleDetectedAt: null,
  confirmedByUserId: 'user-1',
  confirmedByDisplayName: 'Alice Admin',
  confirmedAt: '2026-09-08T00:00:00.000Z',
};

describe('ClassificationFieldManager', () => {
  const load = jest.fn();
  const designate = jest.fn();
  const remove = jest.fn();
  const onChanged = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseCandidates.mockReturnValue({
      candidates: [
        { id: 'col-dept', name: 'Department', displayName: 'Department' },
        { id: 'col-func', name: 'Function', displayName: 'Function' },
      ],
      loading: false,
      error: undefined,
      load,
    });
    mockedUseMutations.mockReturnValue({ designate, remove, saving: false, error: undefined });
  });

  it('shows the not-configured message for a library with no designated fields', () => {
    render(<ClassificationFieldManager siteId="site-1" libraries={[library()]} canManage onChanged={onChanged} />);
    expect(screen.getByText(/no classification fields configured/i)).toBeInTheDocument();
  });

  it('renders designated fields with an Active badge', () => {
    render(<ClassificationFieldManager siteId="site-1" libraries={[library({ fields: [activeField] })]} canManage onChanged={onChanged} />);
    expect(screen.getByText('Department')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders a Stale badge for a field whose column vanished', () => {
    render(
      <ClassificationFieldManager
        siteId="site-1"
        libraries={[library({ fields: [{ ...activeField, status: 'Stale', staleDetectedAt: '2026-09-01T00:00:00.000Z' }] })]}
        canManage
        onChanged={onChanged}
      />,
    );
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText(/excluded from coverage/i)).toBeInTheDocument();
  });

  it('loads candidates and designates a selected column, then refetches', async () => {
    designate.mockResolvedValue({ id: 'field-2' });
    render(<ClassificationFieldManager siteId="site-1" libraries={[library()]} canManage onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: /add classification field/i }));
    expect(load).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/column to designate/i), { target: { value: 'col-func' } });
    fireEvent.click(screen.getByRole('button', { name: /designate/i }));

    await waitFor(() => expect(designate).toHaveBeenCalledWith('site-1', 'list-1', 'col-func'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('excludes already-designated columns from the candidate list', () => {
    render(<ClassificationFieldManager siteId="site-1" libraries={[library({ fields: [activeField] })]} canManage onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /add classification field/i }));
    // Department is already designated; only Function should be selectable.
    expect(screen.getByRole('option', { name: 'Function' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Department' })).not.toBeInTheDocument();
  });

  it('removes a designated field, then refetches', async () => {
    remove.mockResolvedValue(true);
    render(<ClassificationFieldManager siteId="site-1" libraries={[library({ fields: [activeField] })]} canManage onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('site-1', 'field-1'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('hides manage controls when canManage is false', () => {
    render(<ClassificationFieldManager siteId="site-1" libraries={[library({ fields: [activeField] })]} canManage={false} onChanged={onChanged} />);
    expect(screen.queryByRole('button', { name: /add classification field/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });
});
