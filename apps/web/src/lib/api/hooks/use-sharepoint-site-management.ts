'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SharePointSiteResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { approveSharePointSite, discoverSharePointSites, listSharePointSites, revokeSharePointSite } from '../endpoints';
import { useApiQuery } from '../use-api-query';

type SiteStatus = SharePointSiteResponse['status'];

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
    data: fetchedSites,
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

  // Optimistic status updates for approve/revoke (both are simple, fast,
  // near-certain-to-succeed status flips — no Graph call, no async work —
  // a good fit unlike, say, triggering a scan, which creates a genuinely
  // new server-generated entity). Applied the instant a mutation starts, so
  // the button/badge reflects the outcome immediately rather than waiting
  // on a round trip. Reconciled (cleared entirely) once any subsequent
  // successful fetch lands — trusting the next real fetch as authoritative
  // rather than trying to match it field-by-field, since this hook never
  // polls on its own (only discover/approve/revoke ever call refetch()), so
  // there is no unrelated background fetch to race against in practice.
  // Rolled back immediately, per-site, if the mutation itself fails.
  const [optimisticStatus, setOptimisticStatus] = useState<Record<string, SiteStatus>>({});

  useEffect(() => {
    if (fetchedSites) setOptimisticStatus({});
  }, [fetchedSites]);

  const sites = useMemo(() => {
    if (!fetchedSites) return undefined;
    if (Object.keys(optimisticStatus).length === 0) return fetchedSites;
    return fetchedSites.map((site) => (site.id in optimisticStatus ? { ...site, status: optimisticStatus[site.id]! } : site));
  }, [fetchedSites, optimisticStatus]);

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

  // Clears just this one site's optimistic override — used on mutation
  // failure, since nothing actually changed server-side and the
  // already-fetched data already reflects the correct (unchanged) status.
  const rollbackOptimisticStatus = useCallback((siteId: string) => {
    setOptimisticStatus((current) => {
      if (!(siteId in current)) return current;
      const next = { ...current };
      delete next[siteId];
      return next;
    });
  }, []);

  const approve = useCallback(
    async (siteId: string) => {
      if (!user) return;
      setMutatingSiteId(siteId);
      setMutateError(undefined);
      setOptimisticStatus((current) => ({ ...current, [siteId]: 'Approved' }));
      try {
        const token = await getAccessToken();
        await approveSharePointSite(user.organizationId, siteId, token);
        refetch();
      } catch (caught) {
        setMutateError(caught instanceof Error ? caught : new Error(String(caught)));
        rollbackOptimisticStatus(siteId);
      } finally {
        setMutatingSiteId(null);
      }
    },
    [user, getAccessToken, refetch, rollbackOptimisticStatus],
  );

  const revoke = useCallback(
    async (siteId: string) => {
      if (!user) return;
      setMutatingSiteId(siteId);
      setMutateError(undefined);
      setOptimisticStatus((current) => ({ ...current, [siteId]: 'Removed' }));
      try {
        const token = await getAccessToken();
        await revokeSharePointSite(user.organizationId, siteId, token);
        refetch();
      } catch (caught) {
        setMutateError(caught instanceof Error ? caught : new Error(String(caught)));
        rollbackOptimisticStatus(siteId);
      } finally {
        setMutatingSiteId(null);
      }
    },
    [user, getAccessToken, refetch, rollbackOptimisticStatus],
  );

  return { sites, loading, error, discover, discovering, discoverError, approve, revoke, mutatingSiteId, mutateError };
}
