'use client';

import { useCallback, useState } from 'react';
import type { RequestUpgradeResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { requestUpgrade } from '../endpoints';

interface UseRequestUpgradeResult {
  submit: (message?: string) => Promise<void>;
  submitting: boolean;
  success: RequestUpgradeResponse | undefined;
  error: Error | undefined;
  reset: () => void;
}

// Mirrors use-trigger-scan.ts's mutation-hook shape exactly. The
// `submitting` re-entry guard at the top of submit() is an extra layer
// beyond the caller disabling its Send button (which is the primary
// defense, same as TriggerScanButton) — belt-and-braces against a
// double-click landing two calls before the first re-render disables the
// button.
export function useRequestUpgrade(): UseRequestUpgradeResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<RequestUpgradeResponse>();
  const [error, setError] = useState<Error>();

  const submit = useCallback(
    async (message?: string) => {
      if (!user || submitting) return;
      setSubmitting(true);
      setError(undefined);
      try {
        const token = await getAccessToken();
        const result = await requestUpgrade(user.organizationId, token, { message });
        setSuccess(result);
      } catch (caught) {
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        setSubmitting(false);
      }
    },
    [user, getAccessToken, submitting],
  );

  const reset = useCallback(() => {
    setSuccess(undefined);
    setError(undefined);
  }, []);

  return { submit, submitting, success, error, reset };
}
