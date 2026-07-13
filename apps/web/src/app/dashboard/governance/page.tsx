'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { GovernanceIssueListQuery, GovernanceIssueStatusValue, GovernanceIssueTypeValue, IssueSeverityFilter } from '@sph/types';
import { ActivityList } from '@/components/governance/activity-list';
import { GovernanceIssueList } from '@/components/governance/governance-issue-list';
import { GovernanceIssueFilters, type GovernanceIssueFilterValues } from '@/components/governance/governance-issue-filters';
import { GovernanceSummaryCards } from '@/components/governance/governance-summary-cards';
import { IssuesByType } from '@/components/governance/issues-by-type';
import { Pagination } from '@/components/ui/pagination';
import { LoadingState, ErrorState } from '@/components/ui/query-state';
import { useAssignableUsers } from '@/lib/api/hooks/use-assignable-users';
import { useGovernanceIssues } from '@/lib/api/hooks/use-governance-issues';
import { useGovernanceSummary } from '@/lib/api/hooks/use-governance-summary';
import { useOrganizationActivity } from '@/lib/api/hooks/use-organization-activity';

function GovernanceDashboardContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  const query: GovernanceIssueListQuery = useMemo(
    () => ({
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      status: (searchParams.get('status') as GovernanceIssueStatusValue | null) ?? undefined,
      severity: (searchParams.get('severity') as IssueSeverityFilter | null) ?? undefined,
      issueType: (searchParams.get('issueType') as GovernanceIssueTypeValue | null) ?? undefined,
      assignedUserId: searchParams.get('assignedUserId') ?? undefined,
    }),
    [searchParams],
  );

  const { data, loading, error } = useGovernanceIssues(query);
  const { data: summary, loading: summaryLoading, error: summaryError } = useGovernanceSummary();
  const { data: assignableUsers } = useAssignableUsers();
  const { data: recentActivity, loading: activityLoading, error: activityError } = useOrganizationActivity({ pageSize: 10 });

  const updateParams = useCallback(
    (updates: Record<string, string | number | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') params.delete(key);
        else params.set(key, String(value));
      }
      router.push(`/dashboard/governance?${params.toString()}`);
    },
    [router, searchParams],
  );

  const handleFilterChange = useCallback(
    (values: GovernanceIssueFilterValues) => {
      updateParams({ ...values, page: 1 });
    },
    [updateParams],
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Governance</h1>

      {summaryLoading && <LoadingState label="Loading summary…" />}
      {summaryError && <ErrorState error={summaryError} />}
      {summary && (
        <div className="space-y-4">
          <GovernanceSummaryCards summary={summary} />
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-medium text-slate-500">Open issues by type</h2>
            <div className="mt-2">
              <IssuesByType byType={summary.byType} />
            </div>
          </div>
        </div>
      )}

      <GovernanceIssueFilters
        values={{ status: query.status, severity: query.severity, issueType: query.issueType, assignedUserId: query.assignedUserId }}
        assignableUsers={assignableUsers ?? []}
        onChange={handleFilterChange}
      />

      {loading && <LoadingState label="Loading governance issues…" />}
      {error && <ErrorState error={error} />}
      {data && (
        <>
          <GovernanceIssueList issues={data.data} />
          <Pagination pagination={data.pagination} onPageChange={(page) => updateParams({ page })} />
        </>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-500">Recent governance activity</h2>
        <div className="mt-2">
          {activityLoading && <LoadingState label="Loading recent activity…" />}
          {activityError && <ErrorState error={activityError} />}
          {recentActivity && <ActivityList activities={recentActivity.data} showIssueLink />}
        </div>
      </div>
    </div>
  );
}

export default function GovernanceDashboardPage(): JSX.Element {
  return (
    <Suspense fallback={<LoadingState />}>
      <GovernanceDashboardContent />
    </Suspense>
  );
}
