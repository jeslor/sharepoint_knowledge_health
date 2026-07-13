import { render, screen, fireEvent } from '@testing-library/react';
import type { GovernanceIssueResponse } from '@sph/types';
import { GovernanceIssueControls } from '../governance-issue-controls';

function issue(overrides: Partial<GovernanceIssueResponse> = {}): GovernanceIssueResponse {
  return {
    id: 'issue-1',
    documentId: 'doc-1',
    documentName: 'Handbook.docx',
    siteName: 'Team Site',
    issueType: 'Freshness',
    severity: 'RequiresReview',
    status: 'Open',
    assignedUserId: null,
    assignedUserName: null,
    resolutionNotes: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    resolvedAt: null,
    stillDetected: true,
    ...overrides,
  };
}

describe('GovernanceIssueControls', () => {
  it('shows a read-only message and no controls for a Member (canManage: false)', () => {
    render(<GovernanceIssueControls issue={issue()} assignableUsers={[]} canManage={false} onUpdate={jest.fn()} saving={false} />);

    expect(screen.getByText(/only an admin or governance manager/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start progress/i })).not.toBeInTheDocument();
  });

  it('offers "Start progress" for an Open issue and calls onUpdate with the next status', () => {
    const onUpdate = jest.fn();
    render(<GovernanceIssueControls issue={issue({ status: 'Open' })} assignableUsers={[]} canManage onUpdate={onUpdate} saving={false} />);

    fireEvent.click(screen.getByRole('button', { name: /start progress/i }));

    expect(onUpdate).toHaveBeenCalledWith({ status: 'InProgress' });
  });

  it('offers "Mark resolved" for an InProgress issue', () => {
    const onUpdate = jest.fn();
    render(<GovernanceIssueControls issue={issue({ status: 'InProgress' })} assignableUsers={[]} canManage onUpdate={onUpdate} saving={false} />);

    fireEvent.click(screen.getByRole('button', { name: /mark resolved/i }));

    expect(onUpdate).toHaveBeenCalledWith({ status: 'Resolved' });
  });

  it('offers "Reopen" for a Resolved issue', () => {
    const onUpdate = jest.fn();
    render(<GovernanceIssueControls issue={issue({ status: 'Resolved' })} assignableUsers={[]} canManage onUpdate={onUpdate} saving={false} />);

    fireEvent.click(screen.getByRole('button', { name: /reopen/i }));

    expect(onUpdate).toHaveBeenCalledWith({ status: 'Open' });
  });

  it('calls onUpdate with the selected assignedUserId when the assignment dropdown changes', () => {
    const onUpdate = jest.fn();
    render(
      <GovernanceIssueControls
        issue={issue()}
        assignableUsers={[{ id: 'user-1', displayName: 'Sarah' }]}
        canManage
        onUpdate={onUpdate}
        saving={false}
      />,
    );

    fireEvent.change(screen.getByLabelText(/assigned to/i), { target: { value: 'user-1' } });

    expect(onUpdate).toHaveBeenCalledWith({ assignedUserId: 'user-1' });
  });

  it('calls onUpdate with resolutionNotes when Save notes is clicked', () => {
    const onUpdate = jest.fn();
    render(<GovernanceIssueControls issue={issue()} assignableUsers={[]} canManage onUpdate={onUpdate} saving={false} />);

    fireEvent.change(screen.getByLabelText(/resolution notes/i), { target: { value: 'Reassigned to Sarah' } });
    fireEvent.click(screen.getByRole('button', { name: /save notes/i }));

    expect(onUpdate).toHaveBeenCalledWith({ resolutionNotes: 'Reassigned to Sarah' });
  });

  it('disables the status transition button while saving', () => {
    render(<GovernanceIssueControls issue={issue()} assignableUsers={[]} canManage onUpdate={jest.fn()} saving />);
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });
});
