import { createTenantContext } from '@sph/database';
import { GovernanceAnalyticsService } from './governance-analytics.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('GovernanceAnalyticsService', () => {
  const service = new GovernanceAnalyticsService();

  const governanceIssues = { findMany: jest.fn() };
  const governanceActivity = { findMany: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ governanceIssues, governanceActivity } as never);
    governanceIssues.findMany.mockResolvedValue([]);
    governanceActivity.findMany.mockResolvedValue([]);
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

  describe('cohort-based views (issuesByType, statusDistribution, resolutionTimeDistribution)', () => {
    it('scopes the cohort query to createdAt within [since, until] plus the given filters', async () => {
      await service.getAnalytics('org-1', {
        since: '2026-06-01T00:00:00.000Z',
        until: '2026-07-01T00:00:00.000Z',
        status: 'Open',
        severity: 'RequiresReview',
        issueType: 'Freshness',
        assignedUserId: 'user-1',
      });

      expect(governanceIssues.findMany).toHaveBeenCalledWith({
        where: {
          status: 'Open',
          severity: 'RequiresReview',
          issueType: 'Freshness',
          assignedUserId: 'user-1',
          createdAt: { gte: new Date('2026-06-01T00:00:00.000Z'), lte: new Date('2026-07-01T00:00:00.000Z') },
        },
      });
    });

    it('buckets issuesByType and statusDistribution from the cohort', async () => {
      governanceIssues.findMany.mockImplementation(async (args: { where: { status?: { not: string } } }) => {
        if (args.where.status && 'not' in args.where.status) return []; // the separate aging query
        return [
          { issueType: 'Freshness', status: 'Open', severity: 'RequiresReview', createdAt: new Date('2026-06-05T00:00:00.000Z'), resolvedAt: null },
          { issueType: 'Freshness', status: 'Resolved', severity: 'NeedsAttention', createdAt: new Date('2026-06-05T00:00:00.000Z'), resolvedAt: new Date('2026-06-06T00:00:00.000Z') },
          { issueType: 'Ownership', status: 'Open', severity: 'NeedsAttention', createdAt: new Date('2026-06-05T00:00:00.000Z'), resolvedAt: null },
        ];
      });

      const result = await service.getAnalytics('org-1', {});

      expect(result.issuesByType).toEqual(
        expect.arrayContaining([
          { label: 'Freshness', count: 2 },
          { label: 'Ownership', count: 1 },
        ]),
      );
      expect(result.statusDistribution).toEqual(
        expect.arrayContaining([
          { label: 'Open', count: 2 },
          { label: 'Resolved', count: 1 },
        ]),
      );
    });

    it('bucket resolutionTimeDistribution only from Resolved cohort issues, by resolvedAt - createdAt', async () => {
      governanceIssues.findMany.mockImplementation(async (args: { where: { status?: { not: string } } }) => {
        if (args.where.status && 'not' in args.where.status) return [];
        return [
          { issueType: 'Freshness', status: 'Resolved', severity: 'NeedsAttention', createdAt: new Date('2026-06-01T00:00:00.000Z'), resolvedAt: new Date('2026-06-01T12:00:00.000Z') }, // <1 day
          { issueType: 'Freshness', status: 'Resolved', severity: 'NeedsAttention', createdAt: new Date('2026-06-01T00:00:00.000Z'), resolvedAt: new Date('2026-06-10T00:00:00.000Z') }, // 30+ days? no, 9 days -> 7-30 days
          { issueType: 'Freshness', status: 'Open', severity: 'NeedsAttention', createdAt: new Date('2026-06-01T00:00:00.000Z'), resolvedAt: null }, // excluded — not Resolved
        ];
      });

      const result = await service.getAnalytics('org-1', {});

      const under1Day = result.resolutionTimeDistribution.find((bucket) => bucket.label === '<1 day');
      const sevenToThirty = result.resolutionTimeDistribution.find((bucket) => bucket.label === '7-30 days');
      expect(under1Day?.count).toBe(1);
      expect(sevenToThirty?.count).toBe(1);
    });
  });

  describe('issueAging', () => {
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
        if (args.where.status && 'not' in args.where.status) {
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

  describe('issueTrends and recentActivityByType (GovernanceActivity-sourced)', () => {
    it('scopes the activity query to createdAt within [since, until] only — no issue-shaped filters apply', async () => {
      await service.getAnalytics('org-1', {
        since: '2026-06-01T00:00:00.000Z',
        until: '2026-06-03T00:00:00.000Z',
        status: 'Open', // deliberately not expected in the activity query below
      });

      expect(governanceActivity.findMany).toHaveBeenCalledWith({
        where: { createdAt: { gte: new Date('2026-06-01T00:00:00.000Z'), lte: new Date('2026-06-03T00:00:00.000Z') } },
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

    it('counts IssueCreated as opened and IssueResolved as resolved on the correct day, ignoring other activity types', async () => {
      governanceActivity.findMany.mockResolvedValue([
        { activityType: 'IssueCreated', createdAt: new Date('2026-06-01T08:00:00.000Z') },
        { activityType: 'IssueCreated', createdAt: new Date('2026-06-01T20:00:00.000Z') },
        { activityType: 'IssueResolved', createdAt: new Date('2026-06-02T00:00:00.000Z') },
        { activityType: 'AssigneeChanged', createdAt: new Date('2026-06-02T00:00:00.000Z') }, // ignored by trends
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

    it('buckets recentActivityByType across every activity type, not just IssueCreated/IssueResolved', async () => {
      governanceActivity.findMany.mockResolvedValue([
        { activityType: 'IssueCreated', createdAt: new Date('2026-06-01T00:00:00.000Z') },
        { activityType: 'OwnerAssigned', createdAt: new Date('2026-06-01T00:00:00.000Z') },
        { activityType: 'OwnerAssigned', createdAt: new Date('2026-06-01T00:00:00.000Z') },
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

  describe('tenant isolation', () => {
    it('only reads this organization\'s tenant context (org isolation via createTenantContext)', async () => {
      await service.getAnalytics('org-42', {});
      expect(mockedCreateContext).toHaveBeenCalledWith('org-42');
    });
  });
});
