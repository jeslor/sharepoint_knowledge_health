import Link from 'next/link';
import { BuildingRegular, PeopleRegular, WarningFilled } from '@fluentui/react-icons';
import type { OrganizationUserResponse, SharePointSiteResponse } from '@sph/types';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/query-state';

interface GovernanceAlertsCardProps {
  sites: SharePointSiteResponse[] | undefined;
  // undefined when the current user isn't an Admin (use-organization-users.ts
  // is Admin-gated server-side) — only Admins can act on user approvals
  // anyway, so this alert simply doesn't apply to other roles.
  users: OrganizationUserResponse[] | undefined;
}

// Phase 10B: "governance workflow requiring attention" — distinct from
// Critical Issues (document-level health findings). Both alerts here are
// real, existing, actionable admin workflows (ADR-0014 site approval,
// ADR-0012 user approval) — not invented categories.
export function GovernanceAlertsCard({ sites, users }: GovernanceAlertsCardProps): JSX.Element {
  const pendingSites = (sites ?? []).filter((site) => site.status === 'Discovered');
  const pendingUsers = (users ?? []).filter((user) => user.status === 'PendingApproval');
  const hasAlerts = pendingSites.length > 0 || pendingUsers.length > 0;

  return (
    <Card>
      <CardHeader title="Governance alerts" icon={WarningFilled} />
      {!hasAlerts ? (
        <EmptyState label="No pending approvals." description="Everything is up to date." />
      ) : (
        <ul className="space-y-4">
          {pendingSites.length > 0 && (
            <li className="flex items-start justify-between gap-4 border-t border-slate-200/60 pt-4 first:border-t-0 first:pt-0">
              <div className="flex items-start gap-3">
                <BuildingRegular fontSize={18} className="mt-0.5 shrink-0 text-amber-600" />
                <div>
                  <p className="text-body-strong text-slate-900">Sites awaiting approval</p>
                  <p className="text-body text-slate-500">
                    {pendingSites.length} site{pendingSites.length === 1 ? '' : 's'} discovered, not yet approved for scanning
                  </p>
                </div>
              </div>
              <Link
                href="/dashboard/sharepoint"
                className="shrink-0 whitespace-nowrap text-body-strong text-brand-600 transition-colors duration-150 ease-premium hover:text-brand-700 hover:underline"
              >
                Review sites
              </Link>
            </li>
          )}
          {pendingUsers.length > 0 && (
            <li className="flex items-start justify-between gap-4 border-t border-slate-200/60 pt-4 first:border-t-0 first:pt-0">
              <div className="flex items-start gap-3">
                <PeopleRegular fontSize={18} className="mt-0.5 shrink-0 text-amber-600" />
                <div>
                  <p className="text-body-strong text-slate-900">Users awaiting approval</p>
                  <p className="text-body text-slate-500">
                    {pendingUsers.length} account{pendingUsers.length === 1 ? '' : 's'} pending admin approval
                  </p>
                </div>
              </div>
              <Link
                href="/dashboard/users"
                className="shrink-0 whitespace-nowrap text-body-strong text-brand-600 transition-colors duration-150 ease-premium hover:text-brand-700 hover:underline"
              >
                Review users
              </Link>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}
