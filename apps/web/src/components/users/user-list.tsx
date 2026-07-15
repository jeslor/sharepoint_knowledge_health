'use client';

import type { OrganizationUserResponse } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';
import { UserStatusBadge } from './user-status-badge';

interface UserListProps {
  users: OrganizationUserResponse[];
  onApprove: (userId: string) => Promise<void>;
  onReject: (userId: string) => Promise<void>;
  mutatingUserId: string | null;
}

// ADR-0012: a PendingApproval user has no product access until an Admin
// acts here — this table is that action, not just a read-only roster view.
export function UserList({ users, onApprove, onReject, mutatingUserId }: UserListProps): JSX.Element {
  if (users.length === 0) {
    return <EmptyState label="No users found." />;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <th className="py-2">Name</th>
          <th className="py-2">Email</th>
          <th className="py-2">Role</th>
          <th className="py-2">Status</th>
          <th className="py-2">Actions</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => {
          const saving = mutatingUserId === user.id;
          const isPending = user.status === 'PendingApproval';
          return (
            <tr key={user.id} className="border-b border-slate-100">
              <td className="py-2 font-medium text-slate-900">{user.displayName}</td>
              <td className="py-2 text-slate-600">{user.email}</td>
              <td className="py-2 text-slate-600">{user.role}</td>
              <td className="py-2">
                <UserStatusBadge status={user.status} />
              </td>
              <td className="py-2">
                {isPending && (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void onApprove(user.id)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void onReject(user.id)}
                      className="text-xs font-medium text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Reject'}
                    </button>
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
