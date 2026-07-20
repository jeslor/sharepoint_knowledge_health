'use client';

import type { SharePointSiteResponse } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';
import { Button } from '@/components/ui/button';
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

  // Phase 10A.6: whitespace-driven rows (no per-row border) + hover
  // feedback (previously missing here, per the original audit).
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200/60 text-xs uppercase tracking-wide text-slate-500">
          <th className="py-2.5">Site</th>
          <th className="py-2.5">Status</th>
          <th className="py-2.5">Last scanned</th>
          {canManage && <th className="py-2.5">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {sites.map((site) => {
          const saving = mutatingSiteId === site.id;
          return (
            <tr key={site.id} className="transition-colors duration-150 ease-premium hover:bg-slate-50">
              <td className="py-3">
                <a href={site.siteUrl} target="_blank" rel="noreferrer" className="font-medium text-slate-900 hover:underline">
                  {site.displayName}
                </a>
              </td>
              <td className="py-3">
                <SharePointSiteStatusBadge status={site.status} />
              </td>
              <td className="py-3 text-slate-600">
                {site.lastScannedAt ? new Date(site.lastScannedAt).toLocaleString() : 'Never'}
              </td>
              {canManage && (
                <td className="py-3">
                  {site.status === 'Discovered' && (
                    <Button variant="secondary" size="sm" disabled={saving} onClick={() => void onApprove(site.id)}>
                      {saving ? 'Approving…' : 'Approve'}
                    </Button>
                  )}
                  {site.status === 'Approved' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={saving}
                      onClick={() => void onRevoke(site.id)}
                      className="text-red-700 hover:bg-red-50 hover:underline"
                    >
                      {saving ? 'Revoking…' : 'Revoke'}
                    </Button>
                  )}
                  {site.status === 'Removed' && (
                    <Button variant="secondary" size="sm" disabled={saving} onClick={() => void onApprove(site.id)}>
                      {saving ? 'Approving…' : 'Re-approve'}
                    </Button>
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
