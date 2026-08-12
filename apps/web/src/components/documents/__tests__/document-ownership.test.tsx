import { render, screen, fireEvent } from '@testing-library/react';
import type { DocumentOwnerResponse } from '@sph/types';
import { DocumentOwnership } from '../document-ownership';

function owner(overrides: Partial<DocumentOwnerResponse> = {}): DocumentOwnerResponse {
  return {
    id: 'owner-1',
    ownerType: 'Author',
    displayName: 'Alice',
    email: 'alice@example.com',
    source: 'GraphMetadata',
    assignedByUserId: null,
    assignedAt: null,
    ...overrides,
  };
}

describe('DocumentOwnership', () => {
  it('renders an empty state when there is no ownership information', () => {
    render(<DocumentOwnership owners={[]} canManage={false} onAssign={jest.fn()} onRemove={jest.fn()} saving={false} />);
    expect(screen.getByText('No owner information yet.')).toBeInTheDocument();
  });

  it('does not show a Remove button for a GraphMetadata-sourced owner, even when canManage', () => {
    render(<DocumentOwnership owners={[owner()]} canManage onAssign={jest.fn()} onRemove={jest.fn()} saving={false} />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('shows a Remove button for a ManualAssignment-sourced owner when canManage, and calls onRemove', () => {
    const onRemove = jest.fn();
    render(
      <DocumentOwnership
        owners={[owner({ id: 'owner-2', displayName: 'Sarah', source: 'ManualAssignment' })]}
        canManage
        onAssign={jest.fn()}
        onRemove={onRemove}
        saving={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    expect(onRemove).toHaveBeenCalledWith('owner-2');
  });

  it('does not show a Remove button for a ManualAssignment owner when canManage is false (Member)', () => {
    render(
      <DocumentOwnership
        owners={[owner({ source: 'ManualAssignment' })]}
        canManage={false}
        onAssign={jest.fn()}
        onRemove={jest.fn()}
        saving={false}
      />,
    );

    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('hides the assignment form entirely when canManage is false', () => {
    render(<DocumentOwnership owners={[]} canManage={false} onAssign={jest.fn()} onRemove={jest.fn()} saving={false} />);
    expect(screen.queryByRole('button', { name: /assign owner/i })).not.toBeInTheDocument();
  });

  it('shows the explanatory permission message instead when canManage is false — closes the self-service dead end', () => {
    render(<DocumentOwnership owners={[]} canManage={false} onAssign={jest.fn()} onRemove={jest.fn()} saving={false} />);
    expect(
      screen.getByText('Setting the owner requires Admin or Governance Manager permissions. Please contact your administrator.'),
    ).toBeInTheDocument();
  });

  it('does not show the explanatory permission message when canManage is true', () => {
    render(<DocumentOwnership owners={[]} canManage onAssign={jest.fn()} onRemove={jest.fn()} saving={false} />);
    expect(screen.queryByText(/requires admin or governance manager permissions/i)).not.toBeInTheDocument();
  });

  it('keeps read-only ownership information visible even when canManage is false', () => {
    render(<DocumentOwnership owners={[owner()]} canManage={false} onAssign={jest.fn()} onRemove={jest.fn()} saving={false} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('calls onAssign with displayName and email when the assignment form is submitted', () => {
    const onAssign = jest.fn();
    render(<DocumentOwnership owners={[]} canManage onAssign={onAssign} onRemove={jest.fn()} saving={false} />);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Sarah' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'sarah@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /assign owner/i }));

    expect(onAssign).toHaveBeenCalledWith({ displayName: 'Sarah', email: 'sarah@example.com' });
  });

  it('disables the Assign owner button when both name and email are empty', () => {
    render(<DocumentOwnership owners={[]} canManage onAssign={jest.fn()} onRemove={jest.fn()} saving={false} />);
    expect(screen.getByRole('button', { name: /assign owner/i })).toBeDisabled();
  });
});
