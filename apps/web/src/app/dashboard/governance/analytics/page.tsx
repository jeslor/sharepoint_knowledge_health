'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { GovernanceAnalyticsQuery, GovernanceIssueStatusValue, GovernanceIssueTypeValue, IssueSeverityFilter } from '@sph/types';
import { AnalyticsBarChart } from '@/components/governance/analytics-bar-chart';
import { AnalyticsFilters, type AnalyticsFilterValues } from '@/components/governance/analytics-filters';
import { ExecutiveSummaryCards } from '@/components/governance/executive-summary-cards';
import { TrendChart } from '@/components/dashboard/trend-chart';
import { LoadingState, ErrorState } from '@/components/ui/query-state';
import { useAssignableUsers } from '@/lib/api/hooks/use-assignable-users';
import { useGovernanceAnalytics } from '@/lib/api/hooks/use-governance-analytics';
import { useGovernanceSummary } from '@/lib/api/hooks/use-governance-summary';

function GovernanceAnalyticsContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  const query: GovernanceAnalyticsQuery = useMemo(
    () => ({
      since: searchParams.get('since') ?? undefined,
      until: searchParams.get('until') ?? undefined,
      status: (searchParams.get('status') as GovernanceIssueStatusValue | null) ?? undefined,
      severity: (searchParams.get('severity') as IssueSeverityFilter | null) ?? undefined,
      issueType: (searchParams.get('issueType') as GovernanceIssueTypeValue | null) ?? undefined,
      assignedUserId: searchParams.get('assignedUserId') ?? undefined,
    }),
    [searchParams],
  );

  const { data: summary, loading: summaryLoading, error: summaryError } = useGovernanceSummary();
  const { data: analytics, loading, error } = useGovernanceAnalytics(query);
  const { data: assignableUsers } = useAssignableUsers();

  const handleFilterChange = useCallback(
    (values: AnalyticsFilterValues) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined && value !== '') params.set(key, value);
      }
      router.push(`/dashboard/governance/analytics?${params.toString()}`);
    },
    [router],
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Governance analytics</h1>

      {summaryLoading && <LoadingState label="Loading summary…" />}
      {summaryError && <ErrorState error={summaryError} />}
      {summary && <ExecutiveSummaryCards summary={summary} />}

      <AnalyticsFilters values={query} assignableUsers={assignableUsers ?? []} onChange={handleFilterChange} />

      {loading && <LoadingState label="Loading analytics…" />}
      {error && <ErrorState error={error} />}
      {analytics && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TrendChart
              title="Issue trend (opened)"
              points={analytics.issueTrends.map((point) => ({ label: point.date.slice(5), value: point.opened }))}
              emptyLabel="Not enough data in this range yet."
            />
            <TrendChart
              title="Resolution trend (resolved)"
              points={analytics.issueTrends.map((point) => ({ label: point.date.slice(5), value: point.resolved }))}
              emptyLabel="Not enough data in this range yet."
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AnalyticsBarChart title="Issues by type" buckets={analytics.issuesByType} />
            <AnalyticsBarChart title="Status distribution" buckets={analytics.statusDistribution} />
            <AnalyticsBarChart title="Resolution time distribution" buckets={analytics.resolutionTimeDistribution} />
            <AnalyticsBarChart title="Issue aging (outstanding work)" buckets={analytics.issueAging} />
          </div>

          <AnalyticsBarChart title="Recent activity summary" buckets={analytics.recentActivityByType} />
        </>
      )}
    </div>
  );
}

export default function GovernanceAnalyticsPage(): JSX.Element {
  return (
    <Suspense fallback={<LoadingState />}>
      <GovernanceAnalyticsContent />
    </Suspense>
  );
}
