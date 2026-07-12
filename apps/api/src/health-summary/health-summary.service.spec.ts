import { createTenantContext } from '@sph/database';
import { HealthSummaryService } from './health-summary.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('HealthSummaryService', () => {
  const service = new HealthSummaryService();

  const documents = { findMany: jest.fn() };
  const healthScores = { findMany: jest.fn() };
  const healthIssues = { findMany: jest.fn() };
  const scanJobs = { findMany: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ documents, healthScores, healthIssues, scanJobs } as never);
    documents.findMany.mockResolvedValue([]);
    healthScores.findMany.mockResolvedValue([]);
    healthIssues.findMany.mockResolvedValue([]);
    scanJobs.findMany.mockResolvedValue([]);
  });

  it('returns zeroed/null summary when the organization has never scored a document or run a scan', async () => {
    const result = await service.getSummary('org-1');

    expect(result).toEqual({
      totalDocumentsScanned: 0,
      averageHealthScore: null,
      criticalIssuesCount: 0,
      warningIssuesCount: 0,
      lastSuccessfulScanAt: null,
      currentScanStatus: null,
    });
  });

  it('computes total documents, average score, and severity counts from current health scores only', async () => {
    documents.findMany.mockResolvedValue([
      { id: 'doc-1', currentHealthScoreId: 'score-1' },
      { id: 'doc-2', currentHealthScoreId: 'score-2' },
    ]);
    healthScores.findMany.mockResolvedValue([
      { id: 'score-1', compositeScore: 40 },
      { id: 'score-2', compositeScore: 80 },
    ]);
    healthIssues.findMany.mockResolvedValue([
      { healthScoreId: 'score-1', severity: 'RequiresReview' },
      { healthScoreId: 'score-1', severity: 'NeedsAttention' },
      { healthScoreId: 'score-2', severity: 'NeedsAttention' },
    ]);

    const result = await service.getSummary('org-1');

    expect(result.totalDocumentsScanned).toBe(2);
    expect(result.averageHealthScore).toBe(60);
    expect(result.criticalIssuesCount).toBe(1);
    expect(result.warningIssuesCount).toBe(2);
  });

  it('reports the most recent ScanJob status regardless of outcome, and the last Completed scan time separately', async () => {
    scanJobs.findMany.mockImplementation(async ({ where }: { where?: { status?: string } } = {}) => {
      if (where?.status === 'Completed') {
        return [{ status: 'Completed', completedAt: new Date('2026-07-10T00:00:00.000Z') }];
      }
      return [{ status: 'Running', completedAt: null }];
    });

    const result = await service.getSummary('org-1');

    expect(result.currentScanStatus).toBe('Running');
    expect(result.lastSuccessfulScanAt).toBe('2026-07-10T00:00:00.000Z');
  });

  it('only aggregates this organization\'s tenant context (org isolation via createTenantContext)', async () => {
    await service.getSummary('org-42');

    expect(mockedCreateContext).toHaveBeenCalledWith('org-42');
  });
});
