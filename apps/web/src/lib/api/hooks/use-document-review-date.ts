'use client';

import { useCallback, useState } from 'react';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { setDocumentReviewDate } from '../endpoints';

interface UseDocumentReviewDateResult {
  setReviewDate: (nextReviewDueAt: string | null) => Promise<void>;
  saving: boolean;
  saveError: Error | undefined;
}

// The review date itself lives on DocumentDetailResponse (useDocument), not
// its own fetch — this hook only exposes the write path, and the caller's
// existing useDocument().refetch() picks up the new value afterward, same
// division of responsibility useDocumentOwners uses between its own fetch
// and its assign/remove actions.
export function useDocumentReviewDate(documentId: string, onSaved: () => void): UseDocumentReviewDateResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error>();

  const setReviewDate = useCallback(
    async (nextReviewDueAt: string | null) => {
      if (!user) return;
      setSaving(true);
      setSaveError(undefined);
      try {
        const token = await getAccessToken();
        await setDocumentReviewDate(user.organizationId, documentId, token, { nextReviewDueAt });
        onSaved();
      } catch (caught) {
        setSaveError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        setSaving(false);
      }
    },
    [user, getAccessToken, documentId, onSaved],
  );

  return { setReviewDate, saving, saveError };
}
