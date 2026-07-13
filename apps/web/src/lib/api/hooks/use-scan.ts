'use client';

import type { ScanResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getScan } from '../endpoints';
import { useApiQuery } from '../use-api-query';

export function useScan(scanId: string): ReturnType<typeof useApiQuery<ScanResponse>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<ScanResponse>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getScan(user.organizationId, scanId, token);
    },
    [user?.organizationId, scanId],
    { enabled: Boolean(user) },
  );
}
