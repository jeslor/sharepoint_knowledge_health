'use client';

import { useCallback, useState } from 'react';
import type { ReviewDateMappingResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { confirmReviewDateMapping } from '../endpoints';

interface UseConfirmReviewDateMappingResult {
  confirm: (siteId: string, graphListId: string, columnDefinitionId?: string) => Promise<ReviewDateMappingResponse | undefined>;
  confirming: boolean;
  confirmError: Error | undefined;
}

/**
 * Phase 2: the one mutating action in this feature. Deliberately no
 * optimistic update (unlike approve/revoke on the Sites page) — activating
 * a mapping changes which system governs a library's review dates going
 * forward, not a quick, near-certain-to-succeed status flip, so the UI
 * waits for the real server response before reflecting success.
 */
export function useConfirmReviewDateMapping(): UseConfirmReviewDateMappingResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<Error>();

  const confirm = useCallback(
    async (siteId: string, graphListId: string, columnDefinitionId?: string) => {
      if (!user) return undefined;
      setConfirming(true);
      setConfirmError(undefined);
      try {
        const token = await getAccessToken();
        return await confirmReviewDateMapping(user.organizationId, siteId, { graphListId, columnDefinitionId }, token);
      } catch (caught) {
        setConfirmError(caught instanceof Error ? caught : new Error(String(caught)));
        return undefined;
      } finally {
        setConfirming(false);
      }
    },
    [user, getAccessToken],
  );

  return { confirm, confirming, confirmError };
}
