'use client';

import type { DocumentDetailResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getDocument } from '../endpoints';
import { useApiQuery } from '../use-api-query';

export function useDocument(documentId: string): ReturnType<typeof useApiQuery<DocumentDetailResponse>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<DocumentDetailResponse>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getDocument(user.organizationId, documentId, token);
    },
    [user?.organizationId, documentId],
    { enabled: Boolean(user) },
  );
}
