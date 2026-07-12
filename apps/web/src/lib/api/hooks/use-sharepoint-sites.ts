'use client';

import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getSharePointSites, type SharePointSiteOption } from '../endpoints';
import { useApiQuery } from '../use-api-query';

export function useSharePointSites(): ReturnType<typeof useApiQuery<SharePointSiteOption[]>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<SharePointSiteOption[]>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getSharePointSites(user.organizationId, token);
    },
    [user?.organizationId],
    { enabled: Boolean(user) },
  );
}
