'use client';

import Link from 'next/link';
import type { SharePointSiteResponse, SharePointSiteStatusValue } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';
import { Button, type ButtonVariant } from '@/components/ui/button';
import { SharePointSiteStatusBadge } from './sharepoint-site-status-badge';

interface SharePointSiteListProps {
  sites: SharePointSiteResponse[];
  canManage: boolean;
  onApprove: (siteId: string) => Promise<void>;
  onRevoke: (siteId: string) => Promise<void>;
  mutatingSiteId: string | null;
  // Ids currently fading out before their owner removes them from `sites`
  // (2026-07-25) — e.g. approving a site while viewing the "Pending" filter
  // tab. Opacity only, deliberately: <tr> elements don't reliably animate
  // transform/height across browsers due to table layout rules, but
  // opacity/color transitions already work (confirmed by the action
  // button's own transition below).
  exitingSiteIds?: ReadonlySet<string>;
}

interface RowAction {
  label: string;
  savingLabel: string;
  variant: ButtonVariant;
  className?: string;
  onClick: () => void;
}

// Root cause fix (2026-07-25): this used to be three mutually-exclusive
// <Button> JSX branches keyed off site.status — when status changed (e.g.
// Discovered → Approved right after an approve), React unmounted one
// Button and mounted a different one (different variant, different DOM
// node), which is a hard swap CSS transitions can't animate across. One
// action config, rendered through a single persistent <Button> below,
// means only its props change across a status transition — letting the
// transition classes already on Button (transition-[color,background-
// color,border-color,transform]) animate the change instead of cutting.
function rowAction(site: SharePointSiteResponse, onApprove: (id: string) => void, onRevoke: (id: string) => void): RowAction | null {
  const ACTIONS: Record<SharePointSiteStatusValue, RowAction> = {
    Discovered: { label: 'Approve', savingLabel: 'Approving…', variant: 'secondary', onClick: () => onApprove(site.id) },
    Approved: {
      label: 'Revoke',
      savingLabel: 'Revoking…',
      variant: 'ghost',
      className: 'text-red-700 hover:bg-red-50 hover:underline',
      onClick: () => onRevoke(site.id),
    },
    Removed: { label: 'Re-approve', savingLabel: 'Approving…', variant: 'secondary', onClick: () => onApprove(site.id) },
  };
  return ACTIONS[site.status] ?? null;
}

// ADR-0014: a site is scan-eligible only once Approved, and never
// auto-approved — this is the one place in the product that action exists.
export function SharePointSiteList({
  sites,
  canManage,
  onApprove,
  onRevoke,
  mutatingSiteId,
  exitingSiteIds,
}: SharePointSiteListProps): JSX.Element {
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
          <th className="py-2.5">Review dates</th>
          {canManage && <th className="py-2.5">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {sites.map((site) => {
          const saving = mutatingSiteId === site.id;
          const action = rowAction(
            site,
            (id) => void onApprove(id),
            (id) => void onRevoke(id),
          );
          const isExiting = exitingSiteIds?.has(site.id) ?? false;
          return (
            <tr
              key={site.id}
              className={`transition-[opacity,background-color] duration-200 ease-premium hover:bg-slate-50 ${isExiting ? 'opacity-0' : ''}`}
            >
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
              <td className="py-3">
                {site.status === 'Approved' ? (
                  <Link href={`/dashboard/sharepoint/${site.id}/review-dates`} className="text-slate-600 hover:text-slate-900 hover:underline">
                    Manage review dates
                  </Link>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              {canManage && (
                <td className="py-3">
                  {action && (
                    <Button variant={action.variant} size="sm" disabled={saving} onClick={action.onClick} className={action.className}>
                      {saving ? action.savingLabel : action.label}
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
