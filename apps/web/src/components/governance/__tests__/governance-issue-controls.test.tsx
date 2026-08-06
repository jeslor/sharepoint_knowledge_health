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
  it('shows a read-only message and no controls for a Member who is neither a manager nor the assignee', () => {
    render(<GovernanceIssueControls issue={issue()} assignableUsers={[]} canManage={false} canSelfService={false} onUpdate={jest.fn()} saving={false} />);

    expect(screen.getByText(/only an admin, a governance manager, or this issue's assignee/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start progress/i })).not.toBeInTheDocument();
  });

  it('offers "Start progress" for an Open issue and calls onUpdate with the next status', () => {
    const onUpdate = jest.fn();
    render(<GovernanceIssueControls issue={issue({ status: 'Open' })} assignableUsers={[]} canManage canSelfService={false} onUpdate={onUpdate} saving={false} />);

    fireEvent.click(screen.getByRole('button', { name: /start progress/i }));

    expect(onUpdate).toHaveBeenCalledWith({ status: 'InProgress' });
  });

  it('offers "Mark resolved" for an InProgress issue', () => {
    const onUpdate = jest.fn();
    render(<GovernanceIssueControls issue={issue({ status: 'InProgress' })} assignableUsers={[]} canManage canSelfService={false} onUpdate={onUpdate} saving={false} />);

    fireEvent.click(screen.getByRole('button', { name: /mark resolved/i }));

    expect(onUpdate).toHaveBeenCalledWith({ status: 'Resolved' });
  });

  it('offers "Reopen" for a Resolved issue', () => {
    const onUpdate = jest.fn();
    render(<GovernanceIssueControls issue={issue({ status: 'Resolved' })} assignableUsers={[]} canManage canSelfService={false} onUpdate={onUpdate} saving={false} />);

    fireEvent.click(screen.getByRole('button', { name: /reopen/i }));

    expect(onUpdate).toHaveBeenCalledWith({ status: 'Open' });
  });

  it('calls onUpdate with the selected assignedUserId when the assignment dropdown changes', () => {
    const onUpdate = jest.fn();
    render(
      <GovernanceIssueControls
        issue={issue()}
        assignableUsers={[{ id: 'user-1', displayName: 'Sarah' }]}
        canManage canSelfService={false}
        onUpdate={onUpdate}
        saving={false}
      />,
    );

    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }));
    fireEvent.click(screen.getByRole('option', { name: 'Sarah' }));

    expect(onUpdate).toHaveBeenCalledWith({ assignedUserId: 'user-1' });
  });

  it('calls onUpdate with resolutionNotes when Save notes is clicked', () => {
    const onUpdate = jest.fn();
    render(<GovernanceIssueControls issue={issue()} assignableUsers={[]} canManage canSelfService={false} onUpdate={onUpdate} saving={false} />);

    fireEvent.change(screen.getByLabelText(/resolution notes/i), { target: { value: 'Reassigned to Sarah' } });
    fireEvent.click(screen.getByRole('button', { name: /save notes/i }));

    expect(onUpdate).toHaveBeenCalledWith({ resolutionNotes: 'Reassigned to Sarah' });
  });

  it('disables the status transition button while saving', () => {
    render(<GovernanceIssueControls issue={issue()} assignableUsers={[]} canManage canSelfService={false} onUpdate={jest.fn()} saving />);
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });

  // ADR-0021 §3.6 / ADR-0016 §16.2: the assignee's narrower self-service
  // rights — forward-only status moves and resolution notes, never
  // reassignment, never reopen. Server-side enforcement is the real
  // boundary (governance-issues.service.spec.ts); these tests prove the
  // UI doesn't even offer what the server would reject.
  describe('self-service (canSelfService: true)', () => {
    it('offers "Start progress" for an Open issue, same as a manager', () => {
      const onUpdate = jest.fn();
      render(
        <GovernanceIssueControls
          issue={issue({ status: 'Open' })}
          assignableUsers={[]}
          canManage={false}
          canSelfService
          onUpdate={onUpdate}
          saving={false}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /start progress/i }));

      expect(onUpdate).toHaveBeenCalledWith({ status: 'InProgress' });
    });

    it('offers "Mark resolved" for an InProgress issue', () => {
      render(
        <GovernanceIssueControls
          issue={issue({ status: 'InProgress' })}
          assignableUsers={[]}
          canManage={false}
          canSelfService
          onUpdate={jest.fn()}
          saving={false}
        />,
      );

      expect(screen.getByRole('button', { name: /mark resolved/i })).toBeInTheDocument();
    });

    it('never offers "Reopen" for a Resolved issue — that stays Admin/GovernanceManager-only', () => {
      render(
        <GovernanceIssueControls
          issue={issue({ status: 'Resolved' })}
          assignableUsers={[]}
          canManage={false}
          canSelfService
          onUpdate={jest.fn()}
          saving={false}
        />,
      );

      expect(screen.queryByRole('button', { name: /reopen/i })).not.toBeInTheDocument();
    });

    it('never renders the "Assigned to" reassignment control, regardless of status', () => {
      render(
        <GovernanceIssueControls
          issue={issue({ status: 'Open' })}
          assignableUsers={[{ id: 'user-1', displayName: 'Sarah' }]}
          canManage={false}
          canSelfService
          onUpdate={jest.fn()}
          saving={false}
        />,
      );

      expect(screen.queryByRole('combobox', { name: /assigned to/i })).not.toBeInTheDocument();
    });

    it('still allows saving resolution notes', () => {
      const onUpdate = jest.fn();
      render(
        <GovernanceIssueControls issue={issue()} assignableUsers={[]} canManage={false} canSelfService onUpdate={onUpdate} saving={false} />,
      );

      fireEvent.change(screen.getByLabelText(/resolution notes/i), { target: { value: 'Cleaned up in SharePoint' } });
      fireEvent.click(screen.getByRole('button', { name: /save notes/i }));

      expect(onUpdate).toHaveBeenCalledWith({ resolutionNotes: 'Cleaned up in SharePoint' });
    });
  });
});
