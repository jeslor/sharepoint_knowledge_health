'use client';

import type { GovernanceIssueListQuery, GovernanceIssueTypeCountsResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getGovernanceIssueTypeCounts } from '../endpoints';
import { useApiQuery } from '../use-api-query';

// Phase 1 work-queue summary strip — deps mirror useGovernanceIssues'
// exactly (minus page/pageSize/sortBy/sortDir, which don't affect a count)
// so the strip refetches in lockstep with the list whenever the effective
// filter scope changes.
export function useGovernanceIssueTypeCounts(
  query: GovernanceIssueListQuery,
): ReturnType<typeof useApiQuery<GovernanceIssueTypeCountsResponse>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<GovernanceIssueTypeCountsResponse>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getGovernanceIssueTypeCounts(user.organizationId, token, query);
    },
    [
      user?.organizationId,
      query.status,
      query.severity,
      query.assignedUserId,
      query.issueType,
      query.documentId,
      query.excludeResolved,
    ],
    { enabled: Boolean(user) },
  );
}
