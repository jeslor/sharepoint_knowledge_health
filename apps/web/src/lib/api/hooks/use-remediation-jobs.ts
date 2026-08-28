'use client';

import type { PaginatedResponse, RemediationJobListQuery, RemediationJobSummary } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { listRemediationJobs } from '../endpoints';
import { useApiQuery } from '../use-api-query';

// P0-7 (ADR-0022 Phase 7): remediation history — same shape as useAuditLog
// (page/pageSize only, no polling; this is a list of past/in-progress jobs
// viewed on demand, not a single job's live progress, which is
// useRemediationJob's concern instead).
export function useRemediationJobs(
  query: RemediationJobListQuery,
): ReturnType<typeof useApiQuery<PaginatedResponse<RemediationJobSummary>>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<PaginatedResponse<RemediationJobSummary>>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return listRemediationJobs(user.organizationId, token, query);
    },
    [user?.organizationId, query.page, query.pageSize],
    { enabled: Boolean(user) },
  );
}
