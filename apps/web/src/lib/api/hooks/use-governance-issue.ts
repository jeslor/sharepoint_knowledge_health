'use client';

import { useCallback, useState } from 'react';
import type { GovernanceIssueResponse, UpdateGovernanceIssueRequest } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getGovernanceIssue, updateGovernanceIssue } from '../endpoints';
import { useApiQuery } from '../use-api-query';

interface UseGovernanceIssueResult {
  issue: GovernanceIssueResponse | undefined;
  loading: boolean;
  error: Error | undefined;
  refetch: () => void;
  update: (request: UpdateGovernanceIssueRequest) => Promise<void>;
  updating: boolean;
  updateError: Error | undefined;
}

export function useGovernanceIssue(issueId: string): UseGovernanceIssueResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  const {
    data: issue,
    loading,
    error,
    refetch,
  } = useApiQuery<GovernanceIssueResponse>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return getGovernanceIssue(user.organizationId, issueId, token);
    },
    [user?.organizationId, issueId],
    { enabled: Boolean(user) },
  );

  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<Error>();

  const update = useCallback(
    async (request: UpdateGovernanceIssueRequest) => {
      if (!user) return;
      setUpdating(true);
      setUpdateError(undefined);
      try {
        const token = await getAccessToken();
        await updateGovernanceIssue(user.organizationId, issueId, token, request);
        refetch();
      } catch (caught) {
        setUpdateError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        setUpdating(false);
      }
    },
    [user, getAccessToken, issueId, refetch],
  );

  return { issue, loading, error, refetch, update, updating, updateError };
}
