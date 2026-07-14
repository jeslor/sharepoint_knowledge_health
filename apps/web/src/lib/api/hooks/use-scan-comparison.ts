'use client';

import type { ScanComparisonResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getScanComparison } from '../endpoints';
import { useApiQuery } from '../use-api-query';

export function useScanComparison(scanId: string): ReturnType<typeof useApiQuery<ScanComparisonResponse>> {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  return useApiQuery<ScanComparisonResponse>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getScanComparison(user.organizationId, scanId, token);
    },
    [user?.organizationId, scanId],
    { enabled: Boolean(user) },
  );
}
