'use client';

import { PageHeader } from '@/components/ui/page-header';
import { LoadingState, ErrorState } from '@/components/ui/query-state';
import { OrganizationHealthHero } from '@/components/dashboard/organization-health-hero';
import { CriticalIssuesCard } from '@/components/dashboard/critical-issues-card';
import { GovernanceAlertsCard } from '@/components/dashboard/governance-alerts-card';
import { RecentScansCard } from '@/components/dashboard/recent-scans-card';
import { HealthTrendsCard } from '@/components/dashboard/health-trends-card';
import { useHealthSummary } from '@/lib/api/hooks/use-health-summary';
import { useHealthTrends } from '@/lib/api/hooks/use-health-trends';
import { useGovernanceSummary } from '@/lib/api/hooks/use-governance-summary';
import { useSharePointSiteManagement } from '@/lib/api/hooks/use-sharepoint-site-management';
import { useOrganizationUsers } from '@/lib/api/hooks/use-organization-users';
import { useScans } from '@/lib/api/hooks/use-scans';

/**
 * Phase 10B — the dashboard's job: tell an administrator the health of
 * their knowledge environment and what requires action. Composition
 * follows the approved priority order (overall health → problems
 * requiring attention → operational activity → historical trends) via an
 * asymmetric layout, not a uniform grid of equal-weight cards — every
 * section below reuses the existing design system (Card/CardHeader/
 * PageHeader/Badge/EmptyState), no new styling patterns introduced.
 */
export default function DashboardPage(): JSX.Element {
  const { data: summary, loading: summaryLoading, error: summaryError } = useHealthSummary();
  const { data: trend, loading: trendLoading, error: trendError } = useHealthTrends();
  const { data: governanceSummary, loading: governanceLoading, error: governanceError } = useGovernanceSummary();
  const { sites, loading: sitesLoading, error: sitesError } = useSharePointSiteManagement();
  const { users, loading: usersLoading, error: usersError } = useOrganizationUsers();
  const { data: scans, loading: scansLoading, error: scansError } = useScans();

  if (summaryLoading) return <LoadingState label="Loading organization health…" variant="card" />;
  if (summaryError) return <ErrorState error={summaryError} />;
  if (!summary) return <LoadingState variant="card" />;

  return (
    <div className="space-y-10">
      <PageHeader title="Organization Health" description="Monitor SharePoint knowledge quality, governance, and compliance." />

      <OrganizationHealthHero summary={summary} />

      {/* Asymmetric hierarchy (plan): Critical Issues gets the wider column
          and comes first — "what should I fix?" is the second most
          important question on the page, right after "how healthy am I?" */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {governanceLoading && <LoadingState label="Loading critical issues…" variant="card" />}
          {governanceError && <ErrorState error={governanceError} />}
          {governanceSummary && <CriticalIssuesCard summary={governanceSummary} />}
        </div>
        <div>
          {(sitesLoading || usersLoading) && <LoadingState label="Loading governance alerts…" variant="card" />}
          {sitesError && <ErrorState error={sitesError} />}
          {usersError && <ErrorState error={usersError} />}
          {!sitesLoading && !usersLoading && <GovernanceAlertsCard sites={sites} users={users} />}
        </div>
      </div>

      {/* Recent Scans + Health Trends: operational activity and trend
          context — visually smaller/lower-priority than the sections above. */}
      <div>
        {scansLoading && <LoadingState label="Loading recent scans…" variant="card" />}
        {scansError && <ErrorState error={scansError} />}
        {scans && <RecentScansCard scans={scans} />}
      </div>

      <div>
        {trendLoading && <LoadingState label="Loading trends…" />}
        {trendError && <ErrorState error={trendError} />}
        {trend && <HealthTrendsCard trend={trend} />}
      </div>
    </div>
  );
}
