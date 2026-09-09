'use client';

import { useCallback, useState } from 'react';
import type { ClassificationFieldResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { designateClassificationField, removeClassificationField } from '../endpoints';

interface UseClassificationFieldMutationsResult {
  designate: (siteId: string, graphListId: string, columnDefinitionId: string) => Promise<ClassificationFieldResponse | undefined>;
  remove: (siteId: string, fieldId: string) => Promise<boolean>;
  saving: boolean;
  error: Error | undefined;
}

/**
 * ADR-0025: the two mutating actions for classification-field config. No
 * optimistic update — designating/removing a field changes what counts
 * toward taxonomy coverage going forward, so the UI waits for the real
 * server response and the caller refetches, matching useConfirmReviewDateMapping.
 */
export function useClassificationFieldMutations(): UseClassificationFieldMutationsResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error>();

  const designate = useCallback(
    async (siteId: string, graphListId: string, columnDefinitionId: string) => {
      if (!user) return undefined;
      setSaving(true);
      setError(undefined);
      try {
        const token = await getAccessToken();
        return await designateClassificationField(user.organizationId, siteId, { graphListId, columnDefinitionId }, token);
      } catch (caught) {
        setError(caught instanceof Error ? caught : new Error(String(caught)));
        return undefined;
      } finally {
        setSaving(false);
      }
    },
    [user, getAccessToken],
  );

  const remove = useCallback(
    async (siteId: string, fieldId: string) => {
      if (!user) return false;
      setSaving(true);
      setError(undefined);
      try {
        const token = await getAccessToken();
        await removeClassificationField(user.organizationId, siteId, fieldId, token);
        return true;
      } catch (caught) {
        setError(caught instanceof Error ? caught : new Error(String(caught)));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [user, getAccessToken],
  );

  return { designate, remove, saving, error };
}
