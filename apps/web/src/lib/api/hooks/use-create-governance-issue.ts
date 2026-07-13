'use client';

import { useCallback, useState } from 'react';
import type { CreateGovernanceIssueRequest, GovernanceIssueResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { createGovernanceIssue } from '../endpoints';

interface UseCreateGovernanceIssueResult {
  create: (request: CreateGovernanceIssueRequest) => Promise<GovernanceIssueResponse>;
  creating: boolean;
  error: Error | undefined;
}

// ADR-0016 §4.1: the lazy-creation moment — a GovernanceIssue only comes
// into existence once a human takes this first action on a raw,
// scan-produced HealthIssue finding.
export function useCreateGovernanceIssue(): UseCreateGovernanceIssueResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<Error>();

  const create = useCallback(
    async (request: CreateGovernanceIssueRequest): Promise<GovernanceIssueResponse> => {
      if (!user) throw new Error('Not authenticated');
      setCreating(true);
      setError(undefined);
      try {
        const token = await getAccessToken();
        return await createGovernanceIssue(user.organizationId, token, request);
      } catch (caught) {
        const err = caught instanceof Error ? caught : new Error(String(caught));
        setError(err);
        throw err;
      } finally {
        setCreating(false);
      }
    },
    [user, getAccessToken],
  );

  return { create, creating, error };
}
