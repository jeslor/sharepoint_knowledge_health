'use client';

import { Suspense, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { GovernanceIssueListQuery, GovernanceIssueStatusValue, GovernanceIssueTypeValue, IssueSeverityFilter } from '@sph/types';
import { ActivityList } from '@/components/governance/activity-list';
import { GovernanceIssueList } from '@/components/governance/governance-issue-list';
import { GovernanceIssueFilters, type GovernanceIssueFilterValues } from '@/components/governance/governance-issue-filters';
import { GovernanceSummaryCards } from '@/components/governance/governance-summary-cards';
import { IssuesByType } from '@/components/governance/issues-by-type';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { LoadingState, ErrorState } from '@/components/ui/query-state';
import { useAssignableUsers } from '@/lib/api/hooks/use-assignable-users';
import { useGovernanceIssues } from '@/lib/api/hooks/use-governance-issues';
import { useGovernanceIssueTypeCounts } from '@/lib/api/hooks/use-governance-issue-type-counts';
import { useGovernanceSummary } from '@/lib/api/hooks/use-governance-summary';
import { useOrganizationActivity } from '@/lib/api/hooks/use-organization-activity';
import { useCurrentUser } from '@/lib/auth/current-user-context';

type WorkQueueView = 'mine' | 'all';

function GovernanceDashboardContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useCurrentUser();

  // Phase 1 work-queue default: absent (or explicitly 'mine') means "My
  // Issues" — mirrors NotificationsPageContent's "All / Unread only"
  // toggle shape (default represented by absence, one explicit alternate
  // state represented by a specific param value).
  const view: WorkQueueView = searchParams.get('view') === 'all' ? 'all' : 'mine';

  const explicitFilters = useMemo(
    () => ({
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      status: (searchParams.get('status') as GovernanceIssueStatusValue | null) ?? undefined,
      severity: (searchParams.get('severity') as IssueSeverityFilter | null) ?? undefined,
      issueType: (searchParams.get('issueType') as GovernanceIssueTypeValue | null) ?? undefined,
      assignedUserId: searchParams.get('assignedUserId') ?? undefined,
    }),
    [searchParams],
  );

  // "My Issues" only ever supplies DEFAULTS — an explicit filter selection
  // (status, or a different assignedUserId picked from the filter bar)
  // always wins and is never silently overridden. This stays entirely
  // client-side: the backend has no notion of "my issues," only the
  // ordinary assignedUserId/excludeResolved filters it already supports —
  // Members are never restricted to their own issues at the API level,
  // this is a default view, not a permission boundary.
  const query: GovernanceIssueListQuery = useMemo(() => {
    if (view !== 'mine' || !user) return explicitFilters;
    return {
      ...explicitFilters,
      assignedUserId: explicitFilters.assignedUserId ?? user.id,
      excludeResolved: explicitFilters.status === undefined ? true : undefined,
      sortBy: 'severity',
    };
  }, [explicitFilters, view, user]);

  const { data, loading, error } = useGovernanceIssues(query);
  const { data: typeCounts, loading: typeCountsLoading, error: typeCountsError } = useGovernanceIssueTypeCounts(query);
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
      <PageHeader
        title="Governance"
        action={
          <div className="flex items-center gap-4">
            <Link href="/dashboard/governance/owners" className="text-sm font-medium text-brand-700 hover:text-brand-800">
              Ownership coverage
            </Link>
            <Link href="/dashboard/governance/analytics" className="text-sm font-medium text-brand-700 hover:text-brand-800">
              View executive analytics
            </Link>
          </div>
        }
      />

      {summaryLoading && <LoadingState label="Loading summary…" />}
      {summaryError && <ErrorState error={summaryError} />}
      {summary && (
        <div className="space-y-4">
          <GovernanceSummaryCards summary={summary} />
          <Card>
            <h2 className="text-body-strong text-slate-700">Open issues by type</h2>
            <div className="mt-3">
              <IssuesByType byType={summary.byType} />
            </div>
          </Card>
        </div>
      )}

      <div className="flex items-center gap-2 text-sm">
        <Button
          variant={view === 'mine' ? 'primary' : 'secondary'}
          size="sm"
          // Explicitly clears assignedUserId too — otherwise a leftover
          // explicit "Assigned to" filter (set while in All Issues) would
          // still win over the My Issues default (explicit filters always
          // take precedence), so the button would read as active while
          // still showing someone else's issues. Clicking My Issues must
          // unambiguously establish "my issues," not just toggle the view.
          onClick={() => updateParams({ view: undefined, assignedUserId: undefined, page: 1 })}
        >
          My Issues
        </Button>
        <Button variant={view === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => updateParams({ view: 'all', page: 1 })}>
          All Issues
        </Button>
      </div>

      <GovernanceIssueFilters
        values={{ status: query.status, severity: query.severity, issueType: query.issueType, assignedUserId: query.assignedUserId }}
        assignableUsers={assignableUsers ?? []}
        onChange={handleFilterChange}
      />

      <Card>
        <h2 className="text-body-strong text-slate-700">{view === 'mine' ? 'My issues by type' : 'Issues by type'}</h2>
        <div className="mt-3">
          {typeCountsLoading && <LoadingState label="Loading summary…" />}
          {typeCountsError && <ErrorState error={typeCountsError} />}
          {typeCounts && (
            <IssuesByType byType={typeCounts.byType} onSelect={(issueType) => updateParams({ issueType, page: 1 })} />
          )}
        </div>
      </Card>

      {loading && <LoadingState label="Loading governance issues…" />}
      {error && <ErrorState error={error} />}
      {data && (
        <>
          <GovernanceIssueList issues={data.data} />
          <Pagination pagination={data.pagination} onPageChange={(page) => updateParams({ page })} />
        </>
      )}

      <Card>
        <h2 className="text-body-strong text-slate-700">Recent governance activity</h2>
        <div className="mt-3">
          {activityLoading && <LoadingState label="Loading recent activity…" />}
          {activityError && <ErrorState error={activityError} />}
          {recentActivity && <ActivityList activities={recentActivity.data} showIssueLink />}
        </div>
      </Card>
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
