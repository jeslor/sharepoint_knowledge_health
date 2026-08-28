'use client';

import { useEffect } from 'react';
import type { RemediationJobDetailResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getRemediationJob } from '../endpoints';
import { useApiQuery } from '../use-api-query';

// P0-7 (ADR-0022 Phase 7): same "poll only while genuinely still in
// flight, stop at a terminal status" discipline as
// apps/web/src/app/dashboard/scans/page.tsx's own
// hasActiveScan/setInterval effect — a still-Running job is the only state
// that can change without the user doing anything, so it's the only state
// worth spending a network request on every tick for. refetch (from
// useApiQuery) already ignores a stale in-flight response if another tick
// fires before it resolves, so this never applies an overlapping response.
const POLL_INTERVAL_MS = 3000;

export function useRemediationJob(jobId: string): ReturnType<typeof useApiQuery<RemediationJobDetailResponse>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  const result = useApiQuery<RemediationJobDetailResponse>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getRemediationJob(user.organizationId, jobId, token);
    },
    [user?.organizationId, jobId],
    { enabled: Boolean(user) },
  );

  const isRunning = result.data?.status === 'Running';
  useEffect(() => {
    if (!isRunning) return undefined;
    const interval = setInterval(result.refetch, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isRunning, result.refetch]);

  return result;
}
