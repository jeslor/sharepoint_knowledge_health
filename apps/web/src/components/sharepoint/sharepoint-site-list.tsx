'use client';

import type { SharePointSiteResponse } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';
import { SharePointSiteStatusBadge } from './sharepoint-site-status-badge';

interface SharePointSiteListProps {
  sites: SharePointSiteResponse[];
  canManage: boolean;
  onApprove: (siteId: string) => Promise<void>;
  onRevoke: (siteId: string) => Promise<void>;
  mutatingSiteId: string | null;
}

// ADR-0014: a site is scan-eligible only once Approved, and never
// auto-approved — this is the one place in the product that action exists.
export function SharePointSiteList({ sites, canManage, onApprove, onRevoke, mutatingSiteId }: SharePointSiteListProps): JSX.Element {
  if (sites.length === 0) {
    return <EmptyState label="No SharePoint sites match this filter yet." />;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <th className="py-2">Site</th>
          <th className="py-2">Status</th>
          <th className="py-2">Last scanned</th>
          {canManage && <th className="py-2">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {sites.map((site) => {
          const saving = mutatingSiteId === site.id;
          return (
            <tr key={site.id} className="border-b border-slate-100">
              <td className="py-2">
                <a href={site.siteUrl} target="_blank" rel="noreferrer" className="font-medium text-slate-900 hover:underline">
                  {site.displayName}
                </a>
              </td>
              <td className="py-2">
                <SharePointSiteStatusBadge status={site.status} />
              </td>
              <td className="py-2 text-slate-600">
                {site.lastScannedAt ? new Date(site.lastScannedAt).toLocaleString() : 'Never'}
              </td>
              {canManage && (
                <td className="py-2">
                  {site.status === 'Discovered' && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void onApprove(site.id)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? 'Approving…' : 'Approve'}
                    </button>
                  )}
                  {site.status === 'Approved' && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void onRevoke(site.id)}
                      className="text-xs font-medium text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? 'Revoking…' : 'Revoke'}
                    </button>
                  )}
                  {site.status === 'Removed' && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void onApprove(site.id)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? 'Approving…' : 'Re-approve'}
                    </button>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
