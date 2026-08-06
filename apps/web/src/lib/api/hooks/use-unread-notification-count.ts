'use client';

import type { UnreadNotificationCountResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getUnreadNotificationCount } from '../endpoints';
import { useApiQuery } from '../use-api-query';

// No push channel exists in this app (REST + BullMQ background jobs only,
// ADR-0009) — polling via useApiQuery's existing pollIntervalMs option is
// the established pattern for a "reasonably fresh, not instant" badge
// (matches its own doc comment's scan-list poll precedent). A named
// constant, not a hardcoded literal at the call site, so the interval is
// one clear place to tune; callers may still override via the
// pollIntervalMs option below if a specific view ever needs a different
// cadence.
export const DEFAULT_UNREAD_NOTIFICATION_POLL_INTERVAL_MS = 60_000;

interface UseUnreadNotificationCountOptions {
  pollIntervalMs?: number;
}

export function useUnreadNotificationCount(
  options: UseUnreadNotificationCountOptions = {},
): ReturnType<typeof useApiQuery<UnreadNotificationCountResponse>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_UNREAD_NOTIFICATION_POLL_INTERVAL_MS;

  return useApiQuery<UnreadNotificationCountResponse>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getUnreadNotificationCount(user.organizationId, token);
    },
    [user?.organizationId],
    { enabled: Boolean(user), pollIntervalMs },
  );
}
