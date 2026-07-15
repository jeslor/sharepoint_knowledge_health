'use client';

import { useCallback, useState } from 'react';
import type { OrganizationUserResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { approveOrganizationUser, listOrganizationUsers, rejectOrganizationUser } from '../endpoints';
import { useApiQuery } from '../use-api-query';

interface UseOrganizationUsersResult {
  users: OrganizationUserResponse[] | undefined;
  loading: boolean;
  error: Error | undefined;
  approve: (userId: string) => Promise<void>;
  reject: (userId: string) => Promise<void>;
  mutatingUserId: string | null;
  mutateError: Error | undefined;
}

/**
 * ADR-0012: fills the approval-inbox gap the ADR itself flagged as
 * deferred — a PendingApproval user previously had no product path to
 * Active status at all (Phase 9.5, docs/testing/local-acceptance-testing.md
 * §1.1). Admin-only server-side (UsersController); this hook is only ever
 * mounted from the Admin-gated Users page.
 */
export function useOrganizationUsers(): UseOrganizationUsersResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  const {
    data: users,
    loading,
    error,
    refetch,
  } = useApiQuery<OrganizationUserResponse[]>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return listOrganizationUsers(user.organizationId, token);
    },
    [user?.organizationId],
    { enabled: Boolean(user && user.role === 'Admin') },
  );

  const [mutatingUserId, setMutatingUserId] = useState<string | null>(null);
  const [mutateError, setMutateError] = useState<Error>();

  const approve = useCallback(
    async (userId: string) => {
      if (!user) return;
      setMutatingUserId(userId);
      setMutateError(undefined);
      try {
        const token = await getAccessToken();
        await approveOrganizationUser(user.organizationId, userId, token);
        refetch();
      } catch (caught) {
        setMutateError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        setMutatingUserId(null);
      }
    },
    [user, getAccessToken, refetch],
  );

  const reject = useCallback(
    async (userId: string) => {
      if (!user) return;
      setMutatingUserId(userId);
      setMutateError(undefined);
      try {
        const token = await getAccessToken();
        await rejectOrganizationUser(user.organizationId, userId, token);
        refetch();
      } catch (caught) {
        setMutateError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        setMutatingUserId(null);
      }
    },
    [user, getAccessToken, refetch],
  );

  return { users, loading, error, approve, reject, mutatingUserId, mutateError };
}
