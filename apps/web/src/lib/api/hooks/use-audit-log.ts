'use client';

import type { AuditLogListQuery, AuditLogResponse, PaginatedResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getAuditLog } from '../endpoints';
import { useApiQuery } from '../use-api-query';

export function useAuditLog(
  query: AuditLogListQuery,
): ReturnType<typeof useApiQuery<PaginatedResponse<AuditLogResponse>>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<PaginatedResponse<AuditLogResponse>>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getAuditLog(user.organizationId, token, query);
    },
    [user?.organizationId, query.page, query.pageSize, query.action, query.targetType, query.since, query.until, query.sortDir],
    { enabled: Boolean(user) },
  );
}
