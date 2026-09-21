'use client';

import type { OrganizationUserResponse } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';
import { Button } from '@/components/ui/button';
import { TableScrollContainer } from '@/components/ui/table-scroll-container';
import { UserStatusBadge } from './user-status-badge';

interface UserListProps {
  users: OrganizationUserResponse[];
  onApprove: (userId: string) => Promise<void>;
  onReject: (userId: string) => Promise<void>;
  mutatingUserId: string | null;
}

// ADR-0012: a PendingApproval user has no product access until an Admin
// acts here — this table is that action, not just a read-only roster view.
export function UserList({
  users,
  onApprove,
  onReject,
  mutatingUserId,
}: UserListProps): JSX.Element {
  if (users.length === 0) {
    return <EmptyState label="No users found." />;
  }

  // Phase 10A.6: whitespace-driven rows (no per-row border) + hover
  // feedback (previously missing here, per the original audit).
  // min-w-[640px] + TableScrollContainer: below that width the table
  // scrolls horizontally within its own region instead of either crushing
  // Email/Name into unreadable columns or forcing the whole page wider.
  return (
    <TableScrollContainer>
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200/60 text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2.5">Name</th>
            <th className="py-2.5">Email</th>
            <th className="py-2.5">Role</th>
            <th className="py-2.5">Status</th>
            <th className="py-2.5">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const saving = mutatingUserId === user.id;
            const isPending = user.status === 'PendingApproval';
            return (
              <tr
                key={user.id}
                className="transition-colors duration-150 ease-premium hover:bg-slate-50"
              >
                <td className="py-3 font-medium text-slate-900">{user.displayName}</td>
                <td className="py-3 text-slate-600">{user.email}</td>
                <td className="py-3 text-slate-600">{user.role}</td>
                <td className="py-3">
                  <UserStatusBadge status={user.status} />
                </td>
                <td className="py-3">
                  {isPending && (
                    <div className="flex gap-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={saving}
                        onClick={() => void onApprove(user.id)}
                      >
                        {saving ? 'Saving…' : 'Approve'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={saving}
                        onClick={() => void onReject(user.id)}
                        className="text-red-700 hover:bg-red-50 hover:underline"
                      >
                        {saving ? 'Saving…' : 'Reject'}
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScrollContainer>
  );
}
