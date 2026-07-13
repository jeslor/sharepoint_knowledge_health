'use client';

import type { GovernanceSummaryResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getGovernanceSummary } from '../endpoints';
import { useApiQuery } from '../use-api-query';

export function useGovernanceSummary(): ReturnType<typeof useApiQuery<GovernanceSummaryResponse>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<GovernanceSummaryResponse>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getGovernanceSummary(user.organizationId, token);
    },
    [user?.organizationId],
    { enabled: Boolean(user) },
  );
}
