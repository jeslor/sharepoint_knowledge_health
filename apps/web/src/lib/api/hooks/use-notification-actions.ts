'use client';

import { useCallback, useState } from 'react';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { markAllNotificationsRead, markNotificationRead } from '../endpoints';

interface UseNotificationActionsResult {
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  working: boolean;
  error: Error | undefined;
}

// Deliberately separate from useNotifications (the list query) — mirrors
// useGovernanceIssue's own query/mutation split. markRead is fire-and-
// forget from the caller's perspective when triggered by a row click (the
// page navigates immediately; it doesn't await this) — exposed as a
// Promise anyway so a caller that DOES want to wait (e.g. before
// refetching the list after "Mark all read") still can.
export function useNotificationActions(onChanged?: () => void): UseNotificationActionsResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<Error>();

  const markRead = useCallback(
    async (notificationId: string) => {
      if (!user) return;
      try {
        const token = await getAccessToken();
        await markNotificationRead(user.organizationId, notificationId, token);
        onChanged?.();
      } catch (caught) {
        // Best-effort from the UI's perspective too — a failed mark-read
        // must never block navigating to the notification's target
        // (matches this feature's backend-side "notification delivery is
        // best-effort, never blocks the real operation" principle).
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      }
    },
    [user, getAccessToken, onChanged],
  );

  const markAllRead = useCallback(async () => {
    if (!user) return;
    setWorking(true);
    setError(undefined);
    try {
      const token = await getAccessToken();
      await markAllNotificationsRead(user.organizationId, token);
      onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      setWorking(false);
    }
  }, [user, getAccessToken, onChanged]);

  return { markRead, markAllRead, working, error };
}
