import { ConflictException, NotFoundException } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import type { Queue } from 'bullmq';
import { ScansService } from './scans.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('ScansService', () => {
  const microsoftTenants = { findFirstById: jest.fn(), findMany: jest.fn() };
  const scanJobs = { create: jest.fn(), findFirstById: jest.fn(), findMany: jest.fn() };
  const healthSnapshots = { findMany: jest.fn() };
  const healthScores = { findMany: jest.fn() };
  const healthIssues = { findMany: jest.fn() };
  const documents = { findMany: jest.fn() };
  const queue = { add: jest.fn() };

  const service = new ScansService(queue as unknown as Queue);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({
      microsoftTenants,
      scanJobs,
      healthSnapshots,
      healthScores,
      healthIssues,
      documents,
    } as never);
    scanJobs.findMany.mockResolvedValue([]); // no scan already in flight, by default
    healthSnapshots.findMany.mockResolvedValue([]);
    healthScores.findMany.mockResolvedValue([]);
    healthIssues.findMany.mockResolvedValue([]);
    documents.findMany.mockResolvedValue([]);
  });

  describe('triggerScan', () => {
    it('throws NotFoundException when the microsoft tenant does not exist', async () => {
      microsoftTenants.findFirstById.mockResolvedValue(null);

      await expect(service.triggerScan('org-1', 'tenant-missing', 'user-1')).rejects.toThrow(NotFoundException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('creates a Queued ScanJob and enqueues a job carrying only { organizationId, scanJobId }', async () => {
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1' });
      const scanJob = { id: 'scan-1', status: 'Queued' };
      scanJobs.create.mockResolvedValue(scanJob);

      const result = await service.triggerScan('org-1', 'tenant-1', 'user-1');

      expect(scanJobs.create).toHaveBeenCalledWith({
        microsoftTenantId: 'tenant-1',
        triggeredByUserId: 'user-1',
        status: 'Queued',
      });
      expect(queue.add).toHaveBeenCalledWith('scan', { organizationId: 'org-1', scanJobId: 'scan-1' });
      expect(result).toBe(scanJob);
    });

    it('rejects with 409 when a scan is already Queued or Running for this Microsoft tenant', async () => {
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1' });
      scanJobs.findMany.mockResolvedValue([{ id: 'scan-existing', status: 'Running' }]);

      await expect(service.triggerScan('org-1', 'tenant-1', 'user-1')).rejects.toThrow(ConflictException);
      expect(scanJobs.create).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('getScan', () => {
    it('throws NotFoundException when the scan job does not exist for this organization', async () => {
      scanJobs.findFirstById.mockResolvedValue(null);

      await expect(service.getScan('org-1', 'scan-missing')).rejects.toThrow(NotFoundException);
    });

    it('returns the scan job when found', async () => {
      const scanJob = { id: 'scan-1', status: 'Running' };
      scanJobs.findFirstById.mockResolvedValue(scanJob);

      const result = await service.getScan('org-1', 'scan-1');

      expect(result).toBe(scanJob);
    });
  });

  describe('listScans', () => {
    it('returns the most recent scans for this organization only, ordered newest first', async () => {
      const scanJob = {
        id: 'scan-1',
        microsoftTenantId: 'tenant-1',
        triggeredByUserId: 'user-1',
        status: 'Completed',
        startedAt: new Date('2026-07-01T00:00:00.000Z'),
        completedAt: new Date('2026-07-01T01:00:00.000Z'),
        documentsScanned: 10,
        documentsFailed: 0,
        errorSummary: null,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        totalSites: 3,
        sitesCompleted: 3,
        currentSiteName: null,
      };
      scanJobs.findMany.mockResolvedValue([scanJob]);

      const result = await service.listScans('org-1');

      expect(scanJobs.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, take: 50 });
      expect(mockedCreateContext).toHaveBeenCalledWith('org-1');
      expect(result).toEqual([
        {
          id: 'scan-1',
          microsoftTenantId: 'tenant-1',
          triggeredByUserId: 'user-1',
          status: 'Completed',
          startedAt: '2026-07-01T00:00:00.000Z',
          completedAt: '2026-07-01T01:00:00.000Z',
          documentsScanned: 10,
          documentsFailed: 0,
          errorSummary: null,
          createdAt: '2026-07-01T00:00:00.000Z',
          totalSites: 3,
          sitesCompleted: 3,
          currentSiteName: null,
        },
      ]);
    });

    it('maps a Running scan\'s in-progress fields through unchanged', async () => {
      scanJobs.findMany.mockResolvedValue([
        {
          id: 'scan-2',
          microsoftTenantId: 'tenant-1',
          triggeredByUserId: 'user-1',
          status: 'Running',
          startedAt: new Date('2026-07-01T00:00:00.000Z'),
          completedAt: null,
          documentsScanned: 4,
          documentsFailed: 0,
          errorSummary: null,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          totalSites: 5,
          sitesCompleted: 2,
          currentSiteName: 'Marketing Docs',
        },
      ]);

      const [result] = await service.listScans('org-1');

      expect(result).toEqual(
        expect.objectContaining({ totalSites: 5, sitesCompleted: 2, currentSiteName: 'Marketing Docs' }),
      );
    });

    it('maps a Scheduled scan\'s null triggeredByUserId and triggerSource through (Phase 7B)', async () => {
      scanJobs.findMany.mockResolvedValue([
        {
          id: 'scan-3',
          microsoftTenantId: 'tenant-1',
          triggeredByUserId: null,
          triggerSource: 'Scheduled',
          status: 'Queued',
          startedAt: null,
          completedAt: null,
          documentsScanned: 0,
          documentsFailed: 0,
          errorSummary: null,
          createdAt: new Date('2026-07-13T02:00:00.000Z'),
          totalSites: null,
          sitesCompleted: 0,
          currentSiteName: null,
        },
      ]);

      const [result] = await service.listScans('org-1');

      expect(result).toEqual(expect.objectContaining({ triggeredByUserId: null, triggerSource: 'Scheduled' }));
    });
  });

  describe('getScanComparison', () => {
    it('throws NotFoundException when the scan does not exist for this organization', async () => {
      scanJobs.findFirstById.mockResolvedValue(null);

      await expect(service.getScanComparison('org-1', 'scan-missing')).rejects.toThrow(NotFoundException);
    });

    it('returns an all-null/empty comparison when the scan has no HealthSnapshot yet (never completed)', async () => {
      scanJobs.findFirstById.mockResolvedValue({ id: 'scan-1', status: 'Running' });
      healthSnapshots.findMany.mockResolvedValue([]);

      const result = await service.getScanComparison('org-1', 'scan-1');

      expect(result).toEqual({
        scanId: 'scan-1',
        previousScanId: null,
        scoreChange: null,
        criticalIssuesChange: null,
        warningIssuesChange: null,
        documentCountChange: null,
        newIssues: [],
        resolvedIssues: [],
      });
    });

    it('returns an all-null/empty comparison when this is the organization\'s first-ever completed scan', async () => {
      scanJobs.findFirstById.mockResolvedValue({ id: 'scan-1', status: 'Completed' });
      healthSnapshots.findMany
        .mockResolvedValueOnce([{ scanJobId: 'scan-1', capturedAt: new Date('2026-07-01T00:00:00.000Z'), averageHealthScore: 82 }])
        .mockResolvedValueOnce([]);

      const result = await service.getScanComparison('org-1', 'scan-1');

      expect(result.previousScanId).toBeNull();
      expect(result.scoreChange).toBeNull();
      expect(result.newIssues).toEqual([]);
      expect(result.resolvedIssues).toEqual([]);
    });

    it('computes score/issue/document count deltas and diffs new vs resolved issues against the immediately preceding scan', async () => {
      scanJobs.findFirstById.mockResolvedValue({ id: 'scan-2', status: 'Completed' });
      healthSnapshots.findMany
        .mockResolvedValueOnce([
          {
            scanJobId: 'scan-2',
            capturedAt: new Date('2026-07-01T00:00:00.000Z'),
            averageHealthScore: 82,
            criticalIssuesCount: 2,
            warningIssuesCount: 3,
            totalDocumentsScanned: 100,
          },
        ])
        .mockResolvedValueOnce([
          {
            scanJobId: 'scan-1',
            capturedAt: new Date('2026-06-01T00:00:00.000Z'),
            averageHealthScore: 70,
            criticalIssuesCount: 5,
            warningIssuesCount: 1,
            totalDocumentsScanned: 90,
          },
        ]);

      healthScores.findMany.mockImplementation(async ({ where }: { where: { scanJobId: string } }) => {
        if (where.scanJobId === 'scan-2') {
          return [
            { id: 'score-2a', documentId: 'doc-1' },
            { id: 'score-2b', documentId: 'doc-2' },
          ];
        }
        if (where.scanJobId === 'scan-1') {
          return [
            { id: 'score-1a', documentId: 'doc-1' },
            { id: 'score-1b', documentId: 'doc-3' },
          ];
        }
        return [];
      });

      const allIssues = [
        { healthScoreId: 'score-2a', criterion: 'Ownership', severity: 'NeedsAttention', message: 'Owner missing' },
        { healthScoreId: 'score-2a', criterion: 'Freshness', severity: 'RequiresReview', message: 'Stale content' },
        { healthScoreId: 'score-2b', criterion: 'Metadata', severity: 'NeedsAttention', message: 'Missing tags' },
        { healthScoreId: 'score-1a', criterion: 'Ownership', severity: 'NeedsAttention', message: 'Owner missing' },
        { healthScoreId: 'score-1b', criterion: 'Duplication', severity: 'RequiresReview', message: 'Duplicate found' },
      ];
      healthIssues.findMany.mockImplementation(async ({ where }: { where: { healthScoreId: { in: string[] } } }) => {
        const ids = where.healthScoreId.in;
        return allIssues.filter((issue) => ids.includes(issue.healthScoreId));
      });

      const allDocuments = [
        { id: 'doc-1', name: 'Handbook.docx' },
        { id: 'doc-2', name: 'Policy.docx' },
        { id: 'doc-3', name: 'Archive.docx' },
      ];
      documents.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => {
        const ids = where.id.in;
        return allDocuments.filter((document) => ids.includes(document.id));
      });

      const result = await service.getScanComparison('org-1', 'scan-2');

      expect(result).toEqual({
        scanId: 'scan-2',
        previousScanId: 'scan-1',
        scoreChange: 12,
        criticalIssuesChange: -3,
        warningIssuesChange: 2,
        documentCountChange: 10,
        newIssues: [
          { documentId: 'doc-1', documentName: 'Handbook.docx', criterion: 'Freshness', severity: 'RequiresReview', message: 'Stale content' },
          { documentId: 'doc-2', documentName: 'Policy.docx', criterion: 'Metadata', severity: 'NeedsAttention', message: 'Missing tags' },
        ],
        resolvedIssues: [
          { documentId: 'doc-3', documentName: 'Archive.docx', criterion: 'Duplication', severity: 'RequiresReview', message: 'Duplicate found' },
        ],
      });
    });

    it('only reads this organization\'s tenant context (org isolation via createTenantContext)', async () => {
      scanJobs.findFirstById.mockResolvedValue({ id: 'scan-1', status: 'Running' });
      healthSnapshots.findMany.mockResolvedValue([]);

      await service.getScanComparison('org-42', 'scan-1');

      expect(mockedCreateContext).toHaveBeenCalledWith('org-42');
    });
  });

  describe('triggerScanForOrganization', () => {
    it('delegates straight to triggerScan when microsoftTenantId is explicitly given', async () => {
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1' });
      scanJobs.create.mockResolvedValue({ id: 'scan-1' });

      await service.triggerScanForOrganization('org-1', 'user-1', 'tenant-1');

      expect(microsoftTenants.findFirstById).toHaveBeenCalledWith('tenant-1');
      expect(microsoftTenants.findMany).not.toHaveBeenCalled();
    });

    it('auto-resolves the single Consented tenant when none is specified', async () => {
      microsoftTenants.findMany.mockResolvedValue([{ id: 'tenant-only', status: 'Consented' }]);
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-only' });
      scanJobs.create.mockResolvedValue({ id: 'scan-1' });

      await service.triggerScanForOrganization('org-1', 'user-1');

      expect(microsoftTenants.findMany).toHaveBeenCalledWith({ where: { status: 'Consented' } });
      expect(microsoftTenants.findFirstById).toHaveBeenCalledWith('tenant-only');
    });

    it('throws NotFoundException when the organization has no connected Microsoft tenant', async () => {
      microsoftTenants.findMany.mockResolvedValue([]);

      await expect(service.triggerScanForOrganization('org-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException (ambiguous) when the organization has more than one connected tenant', async () => {
      microsoftTenants.findMany.mockResolvedValue([{ id: 'tenant-a' }, { id: 'tenant-b' }]);

      await expect(service.triggerScanForOrganization('org-1', 'user-1')).rejects.toThrow(ConflictException);
    });
  });
});
