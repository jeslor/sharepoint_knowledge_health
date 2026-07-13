'use client';

import { useCallback, useState } from 'react';
import type { AssignDocumentOwnerRequest, DocumentOwnerResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { assignDocumentOwner, getDocumentOwners, removeDocumentOwner } from '../endpoints';
import { useApiQuery } from '../use-api-query';

interface UseDocumentOwnersResult {
  owners: DocumentOwnerResponse[] | undefined;
  loading: boolean;
  error: Error | undefined;
  assign: (request: AssignDocumentOwnerRequest) => Promise<void>;
  remove: (ownerId: string) => Promise<void>;
  saving: boolean;
  saveError: Error | undefined;
}

export function useDocumentOwners(documentId: string): UseDocumentOwnersResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  const {
    data: owners,
    loading,
    error,
    refetch,
  } = useApiQuery<DocumentOwnerResponse[]>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getDocumentOwners(user.organizationId, documentId, token);
    },
    [user?.organizationId, documentId],
    { enabled: Boolean(user) },
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error>();

  const assign = useCallback(
    async (request: AssignDocumentOwnerRequest) => {
      if (!user) return;
      setSaving(true);
      setSaveError(undefined);
      try {
        const token = await getAccessToken();
        await assignDocumentOwner(user.organizationId, documentId, token, request);
        refetch();
      } catch (caught) {
        setSaveError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        setSaving(false);
      }
    },
    [user, getAccessToken, documentId, refetch],
  );

  const remove = useCallback(
    async (ownerId: string) => {
      if (!user) return;
      setSaving(true);
      setSaveError(undefined);
      try {
        const token = await getAccessToken();
        await removeDocumentOwner(user.organizationId, documentId, ownerId, token);
        refetch();
      } catch (caught) {
        setSaveError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        setSaving(false);
      }
    },
    [user, getAccessToken, documentId, refetch],
  );

  return { owners, loading, error, assign, remove, saving, saveError };
}
