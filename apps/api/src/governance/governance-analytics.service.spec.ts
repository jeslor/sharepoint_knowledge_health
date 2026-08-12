import { createTenantContext } from '@sph/database';
import { GovernanceAnalyticsService } from './governance-analytics.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('GovernanceAnalyticsService (scale-hardening: SQL GROUP BY for issuesByType/statusDistribution/recentActivityByType)', () => {
  const service = new GovernanceAnalyticsService();

  const governanceIssues = { findMany: jest.fn(), groupByIssueType: jest.fn(), groupByStatus: jest.fn() };
  const governanceActivity = { findMany: jest.fn(), groupByActivityType: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ governanceIssues, governanceActivity } as never);
    governanceIssues.findMany.mockResolvedValue([]);
    governanceIssues.groupByIssueType.mockResolvedValue([]);
    governanceIssues.groupByStatus.mockResolvedValue([]);
    governanceActivity.findMany.mockResolvedValue([]);
    governanceActivity.groupByActivityType.mockResolvedValue([]);
  });

  describe('date window defaults', () => {
    it('defaults to a 30-day window ending now when since/until are not supplied', async () => {
      const result = await service.getAnalytics('org-1', {});

      const since = new Date(result.since);
      const until = new Date(result.until);
      const days = (until.getTime() - since.getTime()) / (24 * 60 * 60 * 1000);
      expect(days).toBeCloseTo(30, 1);
    });

    it('uses the supplied since/until verbatim', async () => {
      const result = await service.getAnalytics('org-1', {
        since: '2026-06-01T00:00:00.000Z',
        until: '2026-06-10T00:00:00.000Z',
      });

      expect(result.since).toBe('2026-06-01T00:00:00.000Z');
      expect(result.until).toBe('2026-06-10T00:00:00.000Z');
    });
  });

  describe('issuesByType / statusDistribution (SQL GROUP BY, cohort-scoped)', () => {
    it('scopes both group-by queries to createdAt within [since, until] plus the given filters', async () => {
      const cohortWhere = {
        status: 'Open',
        severity: 'RequiresReview',
        issueType: 'Freshness',
        assignedUserId: 'user-1',
        createdAt: { gte: new Date('2026-06-01T00:00:00.000Z'), lte: new Date('2026-07-01T00:00:00.000Z') },
      };

      await service.getAnalytics('org-1', {
        since: '2026-06-01T00:00:00.000Z',
        until: '2026-07-01T00:00:00.000Z',
        status: 'Open',
        severity: 'RequiresReview',
        issueType: 'Freshness',
        assignedUserId: 'user-1',
      });

      expect(governanceIssues.groupByIssueType).toHaveBeenCalledWith(cohortWhere);
      expect(governanceIssues.groupByStatus).toHaveBeenCalledWith(cohortWhere);
    });

    it('maps groupByIssueType results directly to issuesByType buckets', async () => {
      governanceIssues.groupByIssueType.mockResolvedValue([
        { issueType: 'Freshness', count: 2 },
        { issueType: 'Ownership', count: 1 },
      ]);

      const result = await service.getAnalytics('org-1', {});

      expect(result.issuesByType).toEqual(
        expect.arrayContaining([
          { label: 'Freshness', count: 2 },
          { label: 'Ownership', count: 1 },
        ]),
      );
    });

    it('maps groupByStatus results directly to statusDistribution buckets', async () => {
      governanceIssues.groupByStatus.mockResolvedValue([
        { status: 'Open', count: 2 },
        { status: 'Resolved', count: 1 },
      ]);

      const result = await service.getAnalytics('org-1', {});

      expect(result.statusDistribution).toEqual(
        expect.arrayContaining([
          { label: 'Open', count: 2 },
          { label: 'Resolved', count: 1 },
        ]),
      );
    });

    it('never fetches the cohort via findMany — issuesByType/statusDistribution never load full rows into memory', async () => {
      await service.getAnalytics('org-1', {});

      // The only two legitimate findMany calls left are the Resolved+dated
      // subset (resolutionTimeDistribution) and the non-Resolved subset
      // (issueAging) — neither is an unfiltered "give me the cohort" fetch.
      const calls = governanceIssues.findMany.mock.calls as [{ where: Record<string, unknown> }][];
      for (const [{ where }] of calls) {
        expect(where.status).toBeDefined();
      }
    });
  });

  describe('resolutionTimeDistribution (narrowed to Resolved+dated cohort subset)', () => {
    it('queries only Resolved issues with a non-null resolvedAt, within the cohort window and filters', async () => {
      await service.getAnalytics('org-1', {
        since: '2026-06-01T00:00:00.000Z',
        until: '2026-07-01T00:00:00.000Z',
        severity: 'RequiresReview',
      });

      expect(governanceIssues.findMany).toHaveBeenCalledWith({
        where: {
          severity: 'RequiresReview',
          createdAt: { gte: new Date('2026-06-01T00:00:00.000Z'), lte: new Date('2026-07-01T00:00:00.000Z') },
          status: 'Resolved',
          resolvedAt: { not: null },
        },
      });
    });

    it('buckets resolutionTimeDistribution by resolvedAt - createdAt', async () => {
      governanceIssues.findMany.mockImplementation(async (args: { where: { status?: unknown } }) => {
        if (args.where.status === 'Resolved') {
          return [
            { createdAt: new Date('2026-06-01T00:00:00.000Z'), resolvedAt: new Date('2026-06-01T12:00:00.000Z') }, // <1 day
            { createdAt: new Date('2026-06-01T00:00:00.000Z'), resolvedAt: new Date('2026-06-10T00:00:00.000Z') }, // 9 days -> 7-30 days
          ];
        }
        return [];
      });

      const result = await service.getAnalytics('org-1', {});

      const under1Day = result.resolutionTimeDistribution.find((bucket) => bucket.label === '<1 day');
      const sevenToThirty = result.resolutionTimeDistribution.find((bucket) => bucket.label === '7-30 days');
      expect(under1Day?.count).toBe(1);
      expect(sevenToThirty?.count).toBe(1);
    });
  });

  describe('issueAging (unchanged: non-Resolved subset, ignores the since/until window)', () => {
    it('queries all non-Resolved issues regardless of the since/until window (aging must not hide old backlog)', async () => {
      await service.getAnalytics('org-1', { since: '2026-07-01T00:00:00.000Z', until: '2026-07-10T00:00:00.000Z' });

      expect(governanceIssues.findMany).toHaveBeenCalledWith({
        where: { status: { not: 'Resolved' } },
      });
    });

    it('still applies the other filters (status/severity/issueType/assignedUserId) to aging', async () => {
      await service.getAnalytics('org-1', { severity: 'RequiresReview' });

      expect(governanceIssues.findMany).toHaveBeenCalledWith({
        where: { severity: 'RequiresReview', status: { not: 'Resolved' } },
      });
    });

    it('buckets aging by (now - createdAt) for currently outstanding issues', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-15T00:00:00.000Z'));
      governanceIssues.findMany.mockImplementation(async (args: { where: { status?: { not: string } } }) => {
        if (args.where.status && typeof args.where.status === 'object' && 'not' in args.where.status) {
          return [{ createdAt: new Date('2026-07-14T00:00:00.000Z') }]; // 1 day old -> "1-3 days"
        }
        return [];
      });

      const result = await service.getAnalytics('org-1', {});

      const oneToThree = result.issueAging.find((bucket) => bucket.label === '1-3 days');
      expect(oneToThree?.count).toBe(1);
      jest.useRealTimers();
    });
  });

  describe('recentActivityByType (SQL GROUP BY on GovernanceActivity)', () => {
    it('scopes the group-by query to createdAt within [since, until] only — no issue-shaped filters apply', async () => {
      await service.getAnalytics('org-1', {
        since: '2026-06-01T00:00:00.000Z',
        until: '2026-06-03T00:00:00.000Z',
        status: 'Open', // deliberately not expected below — GovernanceActivity has no status of its own
      });

      expect(governanceActivity.groupByActivityType).toHaveBeenCalledWith({
        createdAt: { gte: new Date('2026-06-01T00:00:00.000Z'), lte: new Date('2026-06-03T00:00:00.000Z') },
      });
    });

    it('maps groupByActivityType results across every activity type, not just IssueCreated/IssueResolved', async () => {
      governanceActivity.groupByActivityType.mockResolvedValue([
        { activityType: 'IssueCreated', count: 1 },
        { activityType: 'OwnerAssigned', count: 2 },
      ]);

      const result = await service.getAnalytics('org-1', {});

      expect(result.recentActivityByType).toEqual(
        expect.arrayContaining([
          { label: 'IssueCreated', count: 1 },
          { label: 'OwnerAssigned', count: 2 },
        ]),
      );
    });
  });

  describe('issueTrends (GovernanceActivity findMany, narrowed to IssueCreated/IssueResolved only)', () => {
    it('scopes the activity fetch to createdAt within [since, until] AND activityType in [IssueCreated, IssueResolved] — never fetches other activity types just to discard them', async () => {
      await service.getAnalytics('org-1', {
        since: '2026-06-01T00:00:00.000Z',
        until: '2026-06-03T00:00:00.000Z',
        status: 'Open', // deliberately not expected below
      });

      expect(governanceActivity.findMany).toHaveBeenCalledWith({
        where: {
          createdAt: { gte: new Date('2026-06-01T00:00:00.000Z'), lte: new Date('2026-06-03T00:00:00.000Z') },
          activityType: { in: ['IssueCreated', 'IssueResolved'] },
        },
      });
    });

    it('produces one trend point per day in the window, seeded with zero counts, even with no activity', async () => {
      const result = await service.getAnalytics('org-1', {
        since: '2026-06-01T00:00:00.000Z',
        until: '2026-06-03T00:00:00.000Z',
      });

      expect(result.issueTrends).toEqual([
        { date: '2026-06-01', opened: 0, resolved: 0 },
        { date: '2026-06-02', opened: 0, resolved: 0 },
        { date: '2026-06-03', opened: 0, resolved: 0 },
      ]);
    });

    it('counts IssueCreated as opened and IssueResolved as resolved on the correct day', async () => {
      governanceActivity.findMany.mockResolvedValue([
        { activityType: 'IssueCreated', createdAt: new Date('2026-06-01T08:00:00.000Z') },
        { activityType: 'IssueCreated', createdAt: new Date('2026-06-01T20:00:00.000Z') },
        { activityType: 'IssueResolved', createdAt: new Date('2026-06-02T00:00:00.000Z') },
      ]);

      const result = await service.getAnalytics('org-1', {
        since: '2026-06-01T00:00:00.000Z',
        until: '2026-06-03T00:00:00.000Z',
      });

      expect(result.issueTrends).toEqual([
        { date: '2026-06-01', opened: 2, resolved: 0 },
        { date: '2026-06-02', opened: 0, resolved: 1 },
        { date: '2026-06-03', opened: 0, resolved: 0 },
      ]);
    });

    // Defense-in-depth: bucketTrendsByDay still guards against a non-
    // IssueCreated/IssueResolved row even though the query now filters
    // server-side — this proves that safety net still works if it's ever
    // exercised (e.g. a mock, or a future query regression), not just that
    // the happy path is correct.
    it('still ignores a non-IssueCreated/IssueResolved activity type defensively, even if one were somehow returned', async () => {
      governanceActivity.findMany.mockResolvedValue([
        { activityType: 'IssueCreated', createdAt: new Date('2026-06-02T00:00:00.000Z') },
        { activityType: 'AssigneeChanged', createdAt: new Date('2026-06-02T00:00:00.000Z') },
      ]);

      const result = await service.getAnalytics('org-1', {
        since: '2026-06-01T00:00:00.000Z',
        until: '2026-06-03T00:00:00.000Z',
      });

      expect(result.issueTrends.find((point) => point.date === '2026-06-02')).toEqual({
        date: '2026-06-02',
        opened: 1,
        resolved: 0,
      });
    });
  });

  describe('tenant isolation', () => {
    it('only reads this organization\'s tenant context (org isolation via createTenantContext)', async () => {
      await service.getAnalytics('org-42', {});
      expect(mockedCreateContext).toHaveBeenCalledWith('org-42');
    });
  });
});
