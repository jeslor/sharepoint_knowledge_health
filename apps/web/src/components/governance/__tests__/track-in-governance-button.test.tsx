import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TrackInGovernanceButton } from '../track-in-governance-button';

const mockPush = jest.fn();
const mockCreate = jest.fn();
let mockCreating = false;
let mockError: Error | undefined;

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/lib/api/hooks/use-create-governance-issue', () => ({
  useCreateGovernanceIssue: () => ({ create: mockCreate, creating: mockCreating, error: mockError }),
}));

describe('TrackInGovernanceButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreating = false;
    mockError = undefined;
  });

  it('calls create with documentId and issueType, then navigates to the new issue', async () => {
    mockCreate.mockResolvedValue({ id: 'issue-new' });
    render(<TrackInGovernanceButton documentId="doc-1" issueType="Freshness" />);

    fireEvent.click(screen.getByRole('button', { name: /track in governance/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard/governance/issues/issue-new'));
    expect(mockCreate).toHaveBeenCalledWith({ documentId: 'doc-1', issueType: 'Freshness' });
  });

  it('is disabled and shows "Opening…" while the request is in flight', () => {
    mockCreating = true;
    render(<TrackInGovernanceButton documentId="doc-1" issueType="Freshness" />);
    expect(screen.getByRole('button', { name: /opening/i })).toBeDisabled();
  });

  it('renders the error message when creation fails', () => {
    mockError = new Error('A governance issue already exists for this document and issue type');
    render(<TrackInGovernanceButton documentId="doc-1" issueType="Freshness" />);
    expect(screen.getByText('A governance issue already exists for this document and issue type')).toBeInTheDocument();
  });
});
