import { render, screen, fireEvent } from '@testing-library/react';
import type { OrganizationUserResponse } from '@sph/types';
import { UserList } from '../user-list';

function user(overrides: Partial<OrganizationUserResponse> = {}): OrganizationUserResponse {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    displayName: 'Alice',
    role: 'Member',
    status: 'PendingApproval',
    createdAt: '2026-07-01T00:00:00.000Z',
    lastLoginAt: null,
    ...overrides,
  };
}

describe('UserList', () => {
  it('renders an empty state when there are no users', () => {
    render(<UserList users={[]} onApprove={jest.fn()} onReject={jest.fn()} mutatingUserId={null} />);
    expect(screen.getByText('No users found.')).toBeInTheDocument();
  });

  it('shows Approve/Reject actions for a PendingApproval user, and calls onApprove', () => {
    const onApprove = jest.fn();
    render(<UserList users={[user()]} onApprove={onApprove} onReject={jest.fn()} mutatingUserId={null} />);

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    expect(onApprove).toHaveBeenCalledWith('user-1');
  });

  it('calls onReject when the Reject button is clicked', () => {
    const onReject = jest.fn();
    render(<UserList users={[user()]} onApprove={jest.fn()} onReject={onReject} mutatingUserId={null} />);

    fireEvent.click(screen.getByRole('button', { name: /reject/i }));

    expect(onReject).toHaveBeenCalledWith('user-1');
  });

  it('shows no actions for an already-Active user', () => {
    render(<UserList users={[user({ status: 'Active' })]} onApprove={jest.fn()} onReject={jest.fn()} mutatingUserId={null} />);

    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
  });

  it('displays the user\'s role', () => {
    render(<UserList users={[user({ role: 'GovernanceManager' })]} onApprove={jest.fn()} onReject={jest.fn()} mutatingUserId={null} />);

    expect(screen.getByText('GovernanceManager')).toBeInTheDocument();
  });
});
