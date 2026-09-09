'use client';

import { useCallback, useState } from 'react';
import type { ClassificationCandidateColumn } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { listClassificationCandidates } from '../endpoints';

interface UseClassificationCandidatesResult {
  candidates: ClassificationCandidateColumn[] | undefined;
  loading: boolean;
  error: Error | undefined;
  load: () => Promise<void>;
}

/**
 * ADR-0025: lazily lists the designatable columns for one library, on
 * demand — each library row owns its own instance, mirroring
 * useReviewDateEligibility. Not prefetched for a whole site at once (a
 * Graph column read per library), so candidates load only when an admin
 * opens a library to designate a field.
 */
export function useClassificationCandidates(siteId: string, graphListId: string): UseClassificationCandidatesResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  const [candidates, setCandidates] = useState<ClassificationCandidateColumn[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error>();

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(undefined);
    try {
      const token = await getAccessToken();
      setCandidates(await listClassificationCandidates(user.organizationId, siteId, graphListId, token));
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      setLoading(false);
    }
  }, [user, getAccessToken, siteId, graphListId]);

  return { candidates, loading, error, load };
}
