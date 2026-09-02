'use client';

import type { ClassificationLibraryResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { listClassificationLibraries } from '../endpoints';
import { useApiQuery } from '../use-api-query';

interface UseClassificationLibrariesResult {
  libraries: ClassificationLibraryResponse[] | undefined;
  loading: boolean;
  error: Error | undefined;
  refetch: () => void;
}

/**
 * ADR-0025: a site's document libraries with the classification fields
 * already designated for each. Mirrors useReviewDateLibraries — one
 * listDrives sweep plus the org's own DB rows, no per-library Graph calls.
 */
export function useClassificationLibraries(siteId: string): UseClassificationLibrariesResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  const { data: libraries, loading, error, refetch } = useApiQuery<ClassificationLibraryResponse[]>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return listClassificationLibraries(user.organizationId, siteId, token);
    },
    [user?.organizationId, siteId],
    { enabled: Boolean(user) && Boolean(siteId) },
  );

  return { libraries, loading, error, refetch };
}
