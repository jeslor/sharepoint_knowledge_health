'use client';

import type { GovernanceAnalyticsQuery, GovernanceAnalyticsResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getGovernanceAnalytics } from '../endpoints';
import { useApiQuery } from '../use-api-query';

export function useGovernanceAnalytics(
  query: GovernanceAnalyticsQuery = {},
): ReturnType<typeof useApiQuery<GovernanceAnalyticsResponse>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<GovernanceAnalyticsResponse>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getGovernanceAnalytics(user.organizationId, token, query);
    },
    [user?.organizationId, query.since, query.until, query.status, query.severity, query.issueType, query.assignedUserId],
    { enabled: Boolean(user) },
  );
}
