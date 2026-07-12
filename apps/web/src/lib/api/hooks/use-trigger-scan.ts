'use client';

import { useCallback, useState } from 'react';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { triggerScan } from '../endpoints';

interface UseTriggerScanResult {
  trigger: () => Promise<void>;
  triggering: boolean;
  error: Error | undefined;
}

export function useTriggerScan(onTriggered?: () => void): UseTriggerScanResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<Error>();

  const trigger = useCallback(async () => {
    if (!user) return;
    setTriggering(true);
    setError(undefined);
    try {
      const token = await getAccessToken();
      await triggerScan(user.organizationId, token);
      onTriggered?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      setTriggering(false);
    }
  }, [user, getAccessToken, onTriggered]);

  return { trigger, triggering, error };
}
