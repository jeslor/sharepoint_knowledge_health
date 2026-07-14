'use client';

import type { DocumentScoreHistoryResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getDocumentHistory } from '../endpoints';
import { useApiQuery } from '../use-api-query';

export function useDocumentHistory(documentId: string): ReturnType<typeof useApiQuery<DocumentScoreHistoryResponse>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<DocumentScoreHistoryResponse>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getDocumentHistory(user.organizationId, documentId, token);
    },
    [user?.organizationId, documentId],
    { enabled: Boolean(user) },
  );
}
