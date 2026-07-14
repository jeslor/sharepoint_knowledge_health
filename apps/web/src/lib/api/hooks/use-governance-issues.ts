'use client';

import type { GovernanceIssueListQuery, GovernanceIssueResponse, PaginatedResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getGovernanceIssues } from '../endpoints';
import { useApiQuery } from '../use-api-query';

export function useGovernanceIssues(
  query: GovernanceIssueListQuery,
): ReturnType<typeof useApiQuery<PaginatedResponse<GovernanceIssueResponse>>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<PaginatedResponse<GovernanceIssueResponse>>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getGovernanceIssues(user.organizationId, token, query);
    },
    [
      user?.organizationId,
      query.page,
      query.pageSize,
      query.status,
      query.severity,
      query.assignedUserId,
      query.issueType,
      query.documentId,
      query.sortBy,
      query.sortDir,
    ],
    { enabled: Boolean(user) },
  );
}
