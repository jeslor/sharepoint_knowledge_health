'use client';

import type { AssignableUserResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getAssignableUsers } from '../endpoints';
import { useApiQuery } from '../use-api-query';

export function useAssignableUsers(): ReturnType<typeof useApiQuery<AssignableUserResponse[]>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<AssignableUserResponse[]>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getAssignableUsers(user.organizationId, token);
    },
    [user?.organizationId],
    { enabled: Boolean(user) },
  );
}
