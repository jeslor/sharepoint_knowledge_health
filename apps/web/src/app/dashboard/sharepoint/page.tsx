'use client';

import { useMemo, useState } from 'react';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useSharePointSiteManagement } from '@/lib/api/hooks/use-sharepoint-site-management';
import { SharePointSiteFilter, type SharePointSiteFilterValue } from '@/components/sharepoint/sharepoint-site-filter';
import { SharePointSiteList } from '@/components/sharepoint/sharepoint-site-list';
import { ErrorState, LoadingState } from '@/components/ui/query-state';

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">SharePoint Sites</h1>
        {isAdmin && (
          <button
            type="button"
            disabled={discovering}
            onClick={() => void discover()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {discovering ? 'Discovering…' : sites && sites.length > 0 ? 'Refresh discovery' : 'Discover sites'}
          </button>
        )}
      </div>

      {discoverError && <p className="text-sm text-red-700">{discoverError.message}</p>}
      {mutateError && <p className="text-sm text-red-700">{mutateError.message}</p>}

      <SharePointSiteFilter value={filter} onChange={setFilter} />

      {loading && <LoadingState label="Loading sites…" />}
      {error && <ErrorState error={error} />}
      {sites && (
        <SharePointSiteList sites={filteredSites} canManage={isAdmin} onApprove={approve} onRevoke={revoke} mutatingSiteId={mutatingSiteId} />
      )}
    </div>
  );
}
