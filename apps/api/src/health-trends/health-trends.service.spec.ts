import { createTenantContext } from '@sph/database';
import { HealthTrendsService } from './health-trends.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('HealthTrendsService', () => {
  const service = new HealthTrendsService();

  const healthSnapshots = { findMany: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ healthSnapshots } as never);
    healthSnapshots.findMany.mockResolvedValue([]);
  });

  it('returns an empty series when the organization has no HealthSnapshot rows yet', async () => {
    const result = await service.getOrganizationTrend('org-1', 30);

    expect(result).toEqual({ days: 30, points: [] });
  });

  it('serializes HealthSnapshot rows directly, oldest first, without recomputing any aggregate', async () => {
    healthSnapshots.findMany.mockResolvedValue([
      {
        capturedAt: new Date('2026-06-15T00:00:00.000Z'),
        averageHealthScore: 70,
        criticalIssuesCount: 3,
        warningIssuesCount: 5,
        totalDocumentsScanned: 100,
      },
      {
        capturedAt: new Date('2026-07-01T00:00:00.000Z'),
        averageHealthScore: 82,
        criticalIssuesCount: 1,
        warningIssuesCount: 2,
        totalDocumentsScanned: 110,
      },
    ]);

    const result = await service.getOrganizationTrend('org-1', 30);

    expect(result.points).toEqual([
      {
        capturedAt: '2026-06-15T00:00:00.000Z',
        averageHealthScore: 70,
        criticalIssuesCount: 3,
        warningIssuesCount: 5,
        totalDocumentsScanned: 100,
      },
      {
        capturedAt: '2026-07-01T00:00:00.000Z',
        averageHealthScore: 82,
        criticalIssuesCount: 1,
        warningIssuesCount: 2,
        totalDocumentsScanned: 110,
      },
    ]);
  });

  it('queries HealthSnapshot ordered ascending by capturedAt, scoped to a since-date derived from days', async () => {
    await service.getOrganizationTrend('org-1', 7);

    expect(healthSnapshots.findMany).toHaveBeenCalledWith({
      where: { capturedAt: { gte: expect.any(Date) } },
      orderBy: { capturedAt: 'asc' },
    });
    const [[callArgs]] = healthSnapshots.findMany.mock.calls;
    const since = callArgs.where.capturedAt.gte as Date;
    const daysAgo = (Date.now() - since.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeCloseTo(7, 1);
  });

  it('only reads this organization\'s tenant context (org isolation via createTenantContext)', async () => {
    await service.getOrganizationTrend('org-42', 30);

    expect(mockedCreateContext).toHaveBeenCalledWith('org-42');
  });
});
