'use client';

import type { OwnershipCoverageResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getOwnershipCoverage } from '../endpoints';
import { useApiQuery } from '../use-api-query';

// ADR-0024 Phase A: a current-state snapshot, not a running job — no
// polling (unlike use-remediation-job.ts), matching GovernanceAnalytics'
// own uncached-per-request, on-demand-refresh-only precedent.
export function useOwnershipCoverage(): ReturnType<typeof useApiQuery<OwnershipCoverageResponse>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<OwnershipCoverageResponse>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getOwnershipCoverage(user.organizationId, token);
    },
    [user?.organizationId],
    { enabled: Boolean(user) },
  );
}
