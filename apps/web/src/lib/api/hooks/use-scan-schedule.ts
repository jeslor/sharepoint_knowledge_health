'use client';

import { useCallback, useState } from 'react';
import type { CreateScanScheduleRequest, ScanScheduleResponse, UpdateScanScheduleRequest } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { createScanSchedule, getScanSchedule, updateScanSchedule } from '../endpoints';
import { useApiQuery } from '../use-api-query';

interface UseScanScheduleResult {
  schedule: ScanScheduleResponse | null | undefined;
  loading: boolean;
  error: Error | undefined;
  save: (request: CreateScanScheduleRequest | UpdateScanScheduleRequest) => Promise<void>;
  saving: boolean;
  saveError: Error | undefined;
}

/**
 * Fetches the org's current schedule (or null if never configured) and
 * exposes one save() function that decides create vs. update itself,
 * based on whether a schedule currently exists — the component doesn't
 * need to know REST semantics, matching the plan's "component decides,
 * not the API" split.
 */
export function useScanSchedule(): UseScanScheduleResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  const {
    data: schedule,
    loading,
    error,
    refetch,
  } = useApiQuery<ScanScheduleResponse | null>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getScanSchedule(user.organizationId, token);
    },
    [user?.organizationId],
    { enabled: Boolean(user) },
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error>();

  const save = useCallback(
    async (request: CreateScanScheduleRequest | UpdateScanScheduleRequest) => {
      if (!user) return;
      setSaving(true);
      setSaveError(undefined);
      try {
        const token = await getAccessToken();
        if (schedule) {
          await updateScanSchedule(user.organizationId, token, request);
        } else {
          await createScanSchedule(user.organizationId, token, request as CreateScanScheduleRequest);
        }
        refetch();
      } catch (caught) {
        setSaveError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        setSaving(false);
      }
    },
    [user, getAccessToken, schedule, refetch],
  );

  return { schedule, loading, error, save, saving, saveError };
}
