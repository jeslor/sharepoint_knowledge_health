'use client';

import type { HealthTrendResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getHealthTrends } from '../endpoints';
import { useApiQuery } from '../use-api-query';

export function useHealthTrends(days?: number): ReturnType<typeof useApiQuery<HealthTrendResponse>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<HealthTrendResponse>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getHealthTrends(user.organizationId, token, days);
    },
    [user?.organizationId, days],
    { enabled: Boolean(user) },
  );
}
