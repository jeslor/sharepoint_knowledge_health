'use client';

import type { DocumentHealthQuery, DocumentHealthResponse, PaginatedResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getDocumentHealth } from '../endpoints';
import { useApiQuery } from '../use-api-query';

export function useDocumentHealth(
  query: DocumentHealthQuery,
): ReturnType<typeof useApiQuery<PaginatedResponse<DocumentHealthResponse>>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<PaginatedResponse<DocumentHealthResponse>>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getDocumentHealth(user.organizationId, token, query);
    },
    [
      user?.organizationId,
      query.page,
      query.pageSize,
      query.sortBy,
      query.sortDir,
      query.severity,
      query.siteId,
      query.minScore,
      query.maxScore,
    ],
    { enabled: Boolean(user) },
  );
}
