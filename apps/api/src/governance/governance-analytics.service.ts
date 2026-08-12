import { Injectable } from '@nestjs/common';
import { createTenantContext, type GovernanceActivity } from '@sph/database';
import type { AnalyticsBucket, GovernanceAnalyticsQuery, GovernanceAnalyticsResponse, IssueTrendPoint } from '@sph/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const DURATION_BUCKETS = ['<1 day', '1-3 days', '3-7 days', '7-30 days', '30+ days'];

/**
 * Dashboard-chart-shaped governance analytics (Phase 8D), read directly
 * off GovernanceIssue and GovernanceActivity — no new state, no scoring
 * involvement. Two different sources for two different kinds of question:
 *
 * - issueTrends / recentActivityByType come from GovernanceActivity, the
 *   append-only event log — correct even across a reopen/resolve cycle,
 *   since every transition is its own immutable row with its own
 *   timestamp.
 * - issuesByType / statusDistribution / resolutionTimeDistribution /
 *   issueAging come from GovernanceIssue's current-state fields — a
 *   point-in-time snapshot, which is exactly what those four views are
 *   asking for ("what does my backlog look like right now").
 *
 * Scale-hardening pass: issuesByType, statusDistribution, and
 * recentActivityByType are now real SQL GROUP BY queries (bounded to a
 * handful of rows regardless of table size) instead of fetching every
 * matching row into Node to bucket in memory. resolutionTimeDistribution
 * and issueAging remain in-memory: both require bucketing a *computed*
 * duration (resolvedAt - createdAt, or now - createdAt) into 5 fixed
 * histogram buckets, which Prisma's typed groupBy cannot express as a
 * group key without raw SQL — deliberately not introduced here (this
 * codebase uses $queryRaw in exactly one place today, a liveness probe;
 * a duration-histogram aggregate is a materially different, riskier use
 * of raw SQL than this conservative pass is scoped for). Both remaining
 * in-memory fetches are still narrowly filtered, not full-table: the
 * resolution-time fetch is scoped to Resolved+dated rows within the
 * cohort window (a subset, not the full cohort), and issueAging was
 * already scoped to non-Resolved issues only, unchanged.
 */
@Injectable()
export class GovernanceAnalyticsService {
  async getAnalytics(organizationId: string, query: GovernanceAnalyticsQuery): Promise<GovernanceAnalyticsResponse> {
    const context = createTenantContext(organizationId);

    const until = query.until ? new Date(query.until) : new Date();
    const since = query.since ? new Date(query.since) : new Date(until.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);

    const filterWhere = {
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.severity !== undefined ? { severity: query.severity } : {}),
      ...(query.issueType !== undefined ? { issueType: query.issueType } : {}),
      ...(query.assignedUserId !== undefined ? { assignedUserId: query.assignedUserId } : {}),
    };
    const cohortWhere = { ...filterWhere, createdAt: { gte: since, lte: until } };

    const [issuesByTypeCounts, statusDistributionCounts, resolvedCohortIssues, outstandingIssues, recentActivityCounts, trendActivities] =
      await Promise.all([
        context.governanceIssues.groupByIssueType(cohortWhere),
        context.governanceIssues.groupByStatus(cohortWhere),
        // Narrower than the old full-cohort fetch — only the Resolved,
        // dated subset this one metric actually needs.
        context.governanceIssues.findMany({ where: { ...cohortWhere, status: 'Resolved', resolvedAt: { not: null } } }),
        // Aging deliberately ignores the since/until window — its entire
        // purpose is surfacing old outstanding work, which a recent-date
        // filter would otherwise hide. Still respects the other filters.
        // Unchanged from before this pass: already scoped to non-Resolved
        // issues only, not the full table.
        context.governanceIssues.findMany({ where: { ...filterWhere, status: { not: 'Resolved' } } }),
        // GovernanceActivity has no status/severity/issueType/assignedUserId
        // of its own to filter by (it records who did what, not the issue's
        // current attributes) — respects only the date window, not the
        // GovernanceIssue-shaped filters. Documented limitation, not an
        // oversight.
        context.governanceActivity.groupByActivityType({ createdAt: { gte: since, lte: until } }),
        // Narrowed to exactly the two activity types issueTrends actually
        // reads — bucketTrendsByDay used to discard every other type after
        // fetching it; now it's never fetched at all.
        context.governanceActivity.findMany({
          where: { createdAt: { gte: since, lte: until }, activityType: { in: ['IssueCreated', 'IssueResolved'] } },
        }),
      ]);

    const issuesByType: AnalyticsBucket[] = issuesByTypeCounts.map(({ issueType, count }) => ({ label: issueType, count }));
    const statusDistribution: AnalyticsBucket[] = statusDistributionCounts.map(({ status, count }) => ({ label: status, count }));
    const resolutionTimeDistribution = this.bucketByDuration(
      resolvedCohortIssues.map((issue) => issue.resolvedAt!.getTime() - issue.createdAt.getTime()),
    );

    const now = Date.now();
    const issueAging = this.bucketByDuration(outstandingIssues.map((issue) => now - issue.createdAt.getTime()));

    const recentActivityByType: AnalyticsBucket[] = recentActivityCounts.map(({ activityType, count }) => ({
      label: activityType,
      count,
    }));
    const issueTrends = this.bucketTrendsByDay(trendActivities, since, until);

    return {
      since: since.toISOString(),
      until: until.toISOString(),
      issueTrends,
      issuesByType,
      statusDistribution,
      resolutionTimeDistribution,
      issueAging,
      recentActivityByType,
    };
  }

  private bucketByDuration(durationsMs: number[]): AnalyticsBucket[] {
    const counts = new Map(DURATION_BUCKETS.map((label) => [label, 0]));
    for (const ms of durationsMs) {
      const label = this.durationBucketLabel(ms);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return DURATION_BUCKETS.map((label) => ({ label, count: counts.get(label) ?? 0 }));
  }

  private durationBucketLabel(ms: number): string {
    if (ms < DAY_MS) return '<1 day';
    if (ms < 3 * DAY_MS) return '1-3 days';
    if (ms < 7 * DAY_MS) return '3-7 days';
    if (ms < 30 * DAY_MS) return '7-30 days';
    return '30+ days';
  }

  // Seeds every day in [since, until] with zero counts first, so a chart
  // never has a silent gap for a day with no activity.
  private bucketTrendsByDay(activities: GovernanceActivity[], since: Date, until: Date): IssueTrendPoint[] {
    const dayKey = (date: Date): string => date.toISOString().slice(0, 10);
    const points = new Map<string, { opened: number; resolved: number }>();

    const cursor = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
    const untilKey = dayKey(until);
    while (dayKey(cursor) <= untilKey) {
      points.set(dayKey(cursor), { opened: 0, resolved: 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    for (const activity of activities) {
      if (activity.activityType !== 'IssueCreated' && activity.activityType !== 'IssueResolved') continue;
      const key = dayKey(activity.createdAt);
      const point = points.get(key) ?? { opened: 0, resolved: 0 };
      if (activity.activityType === 'IssueCreated') point.opened += 1;
      else point.resolved += 1;
      points.set(key, point);
    }

    return [...points.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));
  }
}
