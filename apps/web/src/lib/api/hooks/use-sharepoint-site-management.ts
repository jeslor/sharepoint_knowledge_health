'use client';

import { useCallback, useState } from 'react';
import type { SharePointSiteResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { approveSharePointSite, discoverSharePointSites, listSharePointSites, revokeSharePointSite } from '../endpoints';
import { useApiQuery } from '../use-api-query';

interface UseSharePointSiteManagementResult {
  sites: SharePointSiteResponse[] | undefined;
  loading: boolean;
  error: Error | undefined;
  discover: () => Promise<void>;
  discovering: boolean;
  discoverError: Error | undefined;
  approve: (siteId: string) => Promise<void>;
  revoke: (siteId: string) => Promise<void>;
  mutatingSiteId: string | null;
  mutateError: Error | undefined;
}

/**
 * ADR-0014: discovery/approval/revocation for the dashboard's Sites page
 * (Phase 9.5) — the same three server-authoritative operations that
 * previously had no web UI at all (docs/testing/local-acceptance-testing.md
 * §1.2), now wired through the exact existing endpoints, unmodified.
 */
export function useSharePointSiteManagement(): UseSharePointSiteManagementResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();

  const {
    data: sites,
    loading,
    error,
    refetch,
  } = useApiQuery<SharePointSiteResponse[]>(
    async () => {
      if (!user) throw new Error('Not authenticated');
      const token = await getAccessToken();
      return listSharePointSites(user.organizationId, token);
    },
    [user?.organizationId],
    { enabled: Boolean(user) },
  );

  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<Error>();

  const discover = useCallback(async () => {
    if (!user) return;
    setDiscovering(true);
    setDiscoverError(undefined);
    try {
      const token = await getAccessToken();
      await discoverSharePointSites(user.organizationId, token);
      refetch();
    } catch (caught) {
      setDiscoverError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      setDiscovering(false);
    }
  }, [user, getAccessToken, refetch]);

  const [mutatingSiteId, setMutatingSiteId] = useState<string | null>(null);
  const [mutateError, setMutateError] = useState<Error>();

  const approve = useCallback(
    async (siteId: string) => {
      if (!user) return;
      setMutatingSiteId(siteId);
      setMutateError(undefined);
      try {
        const token = await getAccessToken();
        await approveSharePointSite(user.organizationId, siteId, token);
        refetch();
      } catch (caught) {
        setMutateError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        setMutatingSiteId(null);
      }
    },
    [user, getAccessToken, refetch],
  );

  const revoke = useCallback(
    async (siteId: string) => {
      if (!user) return;
      setMutatingSiteId(siteId);
      setMutateError(undefined);
      try {
        const token = await getAccessToken();
        await revokeSharePointSite(user.organizationId, siteId, token);
        refetch();
      } catch (caught) {
        setMutateError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        setMutatingSiteId(null);
      }
    },
    [user, getAccessToken, refetch],
  );

  return { sites, loading, error, discover, discovering, discoverError, approve, revoke, mutatingSiteId, mutateError };
}
