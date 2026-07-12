'use client';

import type { HealthSummaryResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getHealthSummary } from '../endpoints';
import { useApiQuery } from '../use-api-query';

export function useHealthSummary(): ReturnType<typeof useApiQuery<HealthSummaryResponse>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<HealthSummaryResponse>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getHealthSummary(user.organizationId, token);
    },
    [user?.organizationId],
    { enabled: Boolean(user) },
  );
}
