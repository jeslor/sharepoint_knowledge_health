'use client';

import type { GovernanceActivityListQuery, GovernanceActivityResponse, PaginatedResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getIssueActivity } from '../endpoints';
import { useApiQuery } from '../use-api-query';

export function useIssueActivity(
  issueId: string,
  query: GovernanceActivityListQuery = {},
): ReturnType<typeof useApiQuery<PaginatedResponse<GovernanceActivityResponse>>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<PaginatedResponse<GovernanceActivityResponse>>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getIssueActivity(user.organizationId, issueId, token, query);
    },
    [user?.organizationId, issueId, query.page, query.pageSize, query.activityType, query.sortDir, query.since, query.until],
    { enabled: Boolean(user) },
  );
}
