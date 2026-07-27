'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SharePointSiteResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useSharePointSiteManagement } from '@/lib/api/hooks/use-sharepoint-site-management';
import { SharePointSiteFilter, type SharePointSiteFilterValue } from '@/components/sharepoint/sharepoint-site-filter';
import { SharePointSiteList } from '@/components/sharepoint/sharepoint-site-list';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

// How long a row fades out before it's actually dropped from the currently
// filtered view — must match SharePointSiteList's own transition duration.
const EXIT_ANIMATION_MS = 200;

// ADR-0014: this page is the only place discovery/approval/revocation are
// reachable from the web UI (Phase 9.5 — previously API-only, see
// docs/testing/local-acceptance-testing.md §1.2). Admin-only actions are
// hidden for other roles here; the server's RolesGuard remains the actual
// authorization boundary regardless of what this page renders.
export default function SharePointSitesPage(): JSX.Element {
  const { user } = useCurrentUser();
  const { sites, loading, error, discover, discovering, discoverError, approve, revoke, mutatingSiteId, mutateError } =
    useSharePointSiteManagement();
  const [filter, setFilter] = useState<SharePointSiteFilterValue>('all');

  const isAdmin = user?.role === 'Admin';

  const filteredSites = useMemo(() => {
    if (!sites) return [];
    if (filter === 'approved') return sites.filter((site) => site.status === 'Approved');
    if (filter === 'pending') return sites.filter((site) => site.status === 'Discovered');
    return sites;
  }, [sites, filter]);

  // Fades a site out before it leaves the *currently filtered* view
  // (2026-07-25) — e.g. approving a site while viewing the "Pending" tab
  // removes it from that view immediately (correct — it's no longer
  // Pending); a brief fade reads as intentional rather than an instant
  // disappearance. Not needed on the "All" view at all: the backend now
  // orders sites by displayName, so approving/revoking never changes a
  // site's position there in the first place.
  const [displayedSites, setDisplayedSites] = useState<SharePointSiteResponse[]>(filteredSites);
  const [exitingSiteIds, setExitingSiteIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(filteredSites.map((site) => site.id));
    const leaving = displayedSites.filter((site) => !currentIds.has(site.id) && !exitingSiteIds.has(site.id));

    if (leaving.length === 0) {
      setDisplayedSites(filteredSites);
      return undefined;
    }

    setExitingSiteIds((current) => new Set([...current, ...leaving.map((site) => site.id)]));
    const timer = setTimeout(() => {
      setExitingSiteIds((current) => {
        const next = new Set(current);
        for (const site of leaving) next.delete(site.id);
        return next;
      });
      setDisplayedSites(filteredSites);
    }, EXIT_ANIMATION_MS);
    return () => clearTimeout(timer);
    // Deliberately only [filteredSites] — displayedSites/exitingSiteIds are
    // read via their current closure value each run, not dependencies of
    // it; including them would re-run this on every state update it itself
    // causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSites]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="SharePoint Sites"
        action={
          isAdmin && (
            <Button disabled={discovering} onClick={() => void discover()}>
              {discovering ? 'Discovering…' : sites && sites.length > 0 ? 'Refresh discovery' : 'Discover sites'}
            </Button>
          )
        }
      />

      {discoverError && <p className="text-sm text-red-700">{discoverError.message}</p>}
      {mutateError && <p className="text-sm text-red-700">{mutateError.message}</p>}

      <SharePointSiteFilter value={filter} onChange={setFilter} />

      {loading && <LoadingState label="Loading sites…" />}
      {error && <ErrorState error={error} />}
      {sites && (
        <SharePointSiteList
          sites={displayedSites}
          canManage={isAdmin}
          onApprove={approve}
          onRevoke={revoke}
          mutatingSiteId={mutatingSiteId}
          exitingSiteIds={exitingSiteIds}
        />
      )}
    </div>
  );
}
