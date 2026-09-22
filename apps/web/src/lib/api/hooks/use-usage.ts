'use client';

import type { UsageResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getUsage } from '../endpoints';
import { useApiQuery } from '../use-api-query';

// Phase 5: rendered from DashboardNav, which — unlike page-level content —
// stays mounted across every dashboard navigation (dashboard/layout.tsx
// only remounts the pathname-keyed <main> content). Polling, matching
// useUnreadNotificationCount's own precedent for exactly this "persistent
// nav widget, no cross-component refetch wiring" situation, is what lets
// the usage indicator eventually reflect a scan's newly-indexed documents
// without introducing a shared cache/global state solely for this feature.
export const DEFAULT_USAGE_POLL_INTERVAL_MS = 60_000;

interface UseUsageOptions {
  pollIntervalMs?: number;
}

export function useUsage(options: UseUsageOptions = {}): ReturnType<typeof useApiQuery<UsageResponse>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_USAGE_POLL_INTERVAL_MS;

  return useApiQuery<UsageResponse>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getUsage(user.organizationId, token);
    },
    [user?.organizationId],
    { enabled: Boolean(user), pollIntervalMs },
  );
}
