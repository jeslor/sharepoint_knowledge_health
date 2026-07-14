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

    // The "cohort": issues opened within [since, until], matching the
    // other filters — drives the three distribution views below. Not the
    // same query as issueAging (see that comment).
    const cohortIssues = await context.governanceIssues.findMany({
      where: { ...filterWhere, createdAt: { gte: since, lte: until } },
    });

    const issuesByType = this.bucketCounts(cohortIssues, (issue) => issue.issueType);
    const statusDistribution = this.bucketCounts(cohortIssues, (issue) => issue.status);
    const resolutionTimeDistribution = this.bucketByDuration(
      cohortIssues
        .filter((issue) => issue.status === 'Resolved' && issue.resolvedAt !== null)
        .map((issue) => issue.resolvedAt!.getTime() - issue.createdAt.getTime()),
    );

    // Aging deliberately ignores the since/until window — its entire
    // purpose is surfacing old outstanding work, which a recent-date
    // filter would otherwise hide. Still respects the other filters.
    const outstandingIssues = await context.governanceIssues.findMany({
      where: { ...filterWhere, status: { not: 'Resolved' } },
    });
    const now = Date.now();
    const issueAging = this.bucketByDuration(outstandingIssues.map((issue) => now - issue.createdAt.getTime()));

    // GovernanceActivity has no status/severity/issueType/assignedUserId
    // of its own to filter by (it records who did what, not the issue's
    // current attributes) — these two views respect only the date window,
    // not the GovernanceIssue-shaped filters. Documented limitation, not
    // an oversight.
    const activities = await context.governanceActivity.findMany({
      where: { createdAt: { gte: since, lte: until } },
    });
    const issueTrends = this.bucketTrendsByDay(activities, since, until);
    const recentActivityByType = this.bucketCounts(activities, (activity) => activity.activityType);

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

  private bucketCounts<T>(items: T[], keyFn: (item: T) => string): AnalyticsBucket[] {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = keyFn(item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => ({ label, count }));
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
