'use client';

import type { ReviewDateLibraryResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { listReviewDateLibraries } from '../endpoints';
import { useApiQuery } from '../use-api-query';

interface UseReviewDateLibrariesResult {
  libraries: ReviewDateLibraryResponse[] | undefined;
  loading: boolean;
  error: Error | undefined;
  refetch: () => void;
}

/**
 * Phase 2: lists a site's document libraries with whatever mapping state
 * already exists — the one prerequisite the Review Date settings page
 * needs that no other hook exposes. Deliberately does not fetch
 * eligibility for unmapped libraries here (that's per-library, lazy, on
 * demand — see use-review-date-eligibility.ts) to avoid turning one page
 * load into two Graph calls per unmapped library.
 */
export function useReviewDateLibraries(siteId: string): UseReviewDateLibrariesResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  const { data: libraries, loading, error, refetch } = useApiQuery<ReviewDateLibraryResponse[]>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return listReviewDateLibraries(user.organizationId, siteId, token);
    },
    [user?.organizationId, siteId],
    { enabled: Boolean(user) && Boolean(siteId) },
  );

  return { libraries, loading, error, refetch };
}
