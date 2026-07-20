'use client';

import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useOrganizationUsers } from '@/lib/api/hooks/use-organization-users';
import { UserList } from '@/components/users/user-list';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/query-state';

export default function UsersPage(): JSX.Element {
  const { user } = useCurrentUser();
  const { users, loading, error, approve, reject, mutatingUserId, mutateError } = useOrganizationUsers();

  if (user && user.role !== 'Admin') {
    return <Card className="text-sm text-slate-600">Only an Admin can manage users.</Card>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Users" />

      {mutateError && <p className="text-sm text-red-700">{mutateError.message}</p>}

      {loading && <LoadingState label="Loading users…" />}
      {error && <ErrorState error={error} />}
      {users && <UserList users={users} onApprove={approve} onReject={reject} mutatingUserId={mutatingUserId} />}
    </div>
  );
}
