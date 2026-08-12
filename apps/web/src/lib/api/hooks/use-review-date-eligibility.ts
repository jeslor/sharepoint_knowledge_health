'use client';

import { useCallback, useState } from 'react';
import type { ReviewDateEligibilityResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { checkReviewDateEligibility } from '../endpoints';

interface UseReviewDateEligibilityResult {
  // undefined distinguishes "not checked yet" from every checked result,
  // including NoEligibleColumn — these are different facts (see ADR-0016
  // §17.4) and must never collapse into the same UI state.
  result: ReviewDateEligibilityResponse | undefined;
  checking: boolean;
  checkError: Error | undefined;
  check: () => Promise<void>;
}

/**
 * Phase 2: one eligibility check for one library, triggered on demand —
 * never auto-run, never prefetched for a whole site's libraries at once
 * (see listReviewDateLibraries's own doc comment for why). Each library
 * row in the UI owns its own instance of this hook, so one row's check
 * never affects another's state.
 */
export function useReviewDateEligibility(siteId: string, graphListId: string): UseReviewDateEligibilityResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  const [result, setResult] = useState<ReviewDateEligibilityResponse>();
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<Error>();

  const check = useCallback(async () => {
    if (!user) return;
    setChecking(true);
    setCheckError(undefined);
    try {
      const token = await getAccessToken();
      const response = await checkReviewDateEligibility(user.organizationId, siteId, graphListId, token);
      setResult(response);
    } catch (caught) {
      setCheckError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      setChecking(false);
    }
  }, [user, getAccessToken, siteId, graphListId]);

  return { result, checking, checkError, check };
}
