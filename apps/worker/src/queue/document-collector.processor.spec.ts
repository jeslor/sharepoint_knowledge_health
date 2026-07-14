import { createTenantContext } from '@sph/database';
import { listDrives, listDocuments, GraphTransientError, type GraphDrive, type GraphDriveItem } from '@sph/graph-client';
import type { Job } from 'bullmq';
import type { ScanJobPayload } from '@sph/types';
import { DocumentCollectorProcessor } from './document-collector.processor';

jest.mock('@sph/database');
jest.mock('@sph/graph-client');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;
const mockedListDrives = listDrives as jest.MockedFunction<typeof listDrives>;
const mockedListDocuments = listDocuments as jest.MockedFunction<typeof listDocuments>;

async function* asyncGen<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

function job(payload: ScanJobPayload): Job<ScanJobPayload> {
  return { data: payload } as Job<ScanJobPayload>;
}

describe('DocumentCollectorProcessor', () => {
  const processor = new DocumentCollectorProcessor();

  const scanJobs = { findFirstById: jest.fn(), updateById: jest.fn() };
  const microsoftTenants = { findFirstById: jest.fn() };
  const sharePointSites = { findMany: jest.fn(), updateById: jest.fn() };
  const documents = { findMany: jest.fn(), create: jest.fn(), updateById: jest.fn() };
  const documentOwners = { findMany: jest.fn(), create: jest.fn(), deleteById: jest.fn() };
  const users = { findMany: jest.fn() };
  const healthScores = { create: jest.fn() };
  const healthIssues = { create: jest.fn() };
  const healthSnapshots = { create: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({
      scanJobs,
      microsoftTenants,
      sharePointSites,
      documents,
      documentOwners,
      users,
      healthScores,
      healthIssues,
      healthSnapshots,
    } as never);

    // Defaults so tests only override what they care about.
    sharePointSites.findMany.mockResolvedValue([]);
    documents.findMany.mockResolvedValue([]);
    documentOwners.findMany.mockResolvedValue([]);
    users.findMany.mockResolvedValue([]);
    healthScores.create.mockResolvedValue({ id: 'score-1' });
    healthSnapshots.create.mockResolvedValue({ id: 'snapshot-1' });
  });

  it('returns early without touching the tenant when the ScanJob no longer exists', async () => {
    scanJobs.findFirstById.mockResolvedValue(null);

    await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-missing' }));

    expect(microsoftTenants.findFirstById).not.toHaveBeenCalled();
    expect(scanJobs.updateById).not.toHaveBeenCalled();
  });

  it('marks the ScanJob Failed when its MicrosoftTenant no longer exists', async () => {
    scanJobs.findFirstById.mockResolvedValue({ id: 'scan-1', microsoftTenantId: 'tenant-missing' });
    microsoftTenants.findFirstById.mockResolvedValue(null);

    await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

    expect(scanJobs.updateById).toHaveBeenCalledWith(
      'scan-1',
      expect.objectContaining({ status: 'Failed' }),
    );
    expect(sharePointSites.findMany).not.toHaveBeenCalled();
  });

  it('queries only Approved sites for this MicrosoftTenant — the ADR-0014 enforcement point', async () => {
    scanJobs.findFirstById.mockResolvedValue({ id: 'scan-1', microsoftTenantId: 'tenant-1' });
    microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', entraTenantId: 'entra-1' });

    await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

    expect(sharePointSites.findMany).toHaveBeenCalledWith({
      where: { microsoftTenantId: 'tenant-1', status: 'Approved' },
    });
    expect(mockedListDrives).not.toHaveBeenCalled();
  });

  describe('collecting an Approved site', () => {
    const drive: GraphDrive = { id: 'drive-1', name: 'Documents', webUrl: 'https://x/drive', driveType: 'documentLibrary' };
    const folderItem = {
      id: 'folder-1',
      name: 'Subfolder',
      webUrl: 'https://x/Subfolder',
      size: 0,
      createdDateTime: '2026-01-01T00:00:00.000Z',
      lastModifiedDateTime: '2026-01-01T00:00:00.000Z',
      parentReference: { driveId: 'drive-1', path: '/drives/drive-1/root:' },
      // no `file` facet — this is what makes it a folder, not a document
    } as GraphDriveItem;
    const fileItem: GraphDriveItem = {
      id: 'item-1',
      name: 'Employee Handbook.docx',
      webUrl: 'https://x/Employee Handbook.docx',
      size: 2048,
      createdDateTime: '2026-01-01T00:00:00.000Z',
      lastModifiedDateTime: '2026-06-01T00:00:00.000Z',
      file: { mimeType: 'application/msword' },
      parentReference: { driveId: 'drive-1', path: '/drives/drive-1/root:' },
      createdBy: { user: { displayName: 'Alice', email: 'alice@example.com' } },
    };

    beforeEach(() => {
      scanJobs.findFirstById.mockResolvedValue({ id: 'scan-1', microsoftTenantId: 'tenant-1' });
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', entraTenantId: 'entra-1' });
      sharePointSites.findMany.mockResolvedValue([
        { id: 'site-1', graphSiteId: 'graph-site-1', displayName: 'Team Site' },
      ]);
      mockedListDrives.mockReturnValue(asyncGen([drive]));
    });

    it('skips folder items (no `file` facet) and persists only real documents', async () => {
      mockedListDocuments.mockReturnValue(asyncGen([folderItem, fileItem]));
      documents.findMany.mockResolvedValue([]); // no existing document for the item lookup, and empty for scoring pass
      documents.create.mockResolvedValue({ id: 'doc-1', siteId: 'site-1', graphItemId: 'item-1' });

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      expect(documents.create).toHaveBeenCalledTimes(1);
      expect(documents.create).toHaveBeenCalledWith(
        expect.objectContaining({ graphItemId: 'item-1', name: 'Employee Handbook.docx', sizeBytes: BigInt(2048) }),
      );
    });

    it('creates an Author DocumentOwner from Graph createdBy metadata', async () => {
      mockedListDocuments.mockReturnValue(asyncGen([fileItem]));
      documents.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        'graphItemId' in where ? [] : [],
      );
      documents.create.mockResolvedValue({ id: 'doc-1', siteId: 'site-1', graphItemId: 'item-1' });

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      expect(documentOwners.create).toHaveBeenCalledWith({
        documentId: 'doc-1',
        ownerType: 'Author',
        displayName: 'Alice',
        email: 'alice@example.com',
        source: 'GraphMetadata',
      });
    });

    it('rescan only deletes/recreates GraphMetadata-sourced owners — a ManualAssignment row is never queried or deleted (ADR-0016 §4.2, the Phase 8 prerequisite fix)', async () => {
      mockedListDocuments.mockReturnValue(asyncGen([fileItem]));
      const existing = { id: 'doc-1', siteId: 'site-1', graphItemId: 'item-1' };
      documents.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        'graphItemId' in where ? [existing] : [],
      );
      documents.updateById.mockResolvedValue(existing);
      documentOwners.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        where.source === 'GraphMetadata' ? [{ id: 'owner-graph-1' }] : [],
      );

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      expect(documentOwners.findMany).toHaveBeenCalledWith({
        where: { documentId: 'doc-1', source: 'GraphMetadata' },
      });
      expect(documentOwners.deleteById).toHaveBeenCalledTimes(1);
      expect(documentOwners.deleteById).toHaveBeenCalledWith('owner-graph-1');
    });

    it('updates the existing Document on rediscovery instead of creating a duplicate', async () => {
      mockedListDocuments.mockReturnValue(asyncGen([fileItem]));
      const existing = { id: 'doc-1', siteId: 'site-1', graphItemId: 'item-1' };
      documents.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        'graphItemId' in where ? [existing] : [],
      );
      documents.updateById.mockResolvedValue(existing);

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      expect(documents.create).not.toHaveBeenCalled();
      expect(documents.updateById).toHaveBeenCalledWith(
        'doc-1',
        expect.objectContaining({ graphItemId: 'item-1' }),
      );
    });

    it('records a site enumeration failure without aborting the rest of the scan', async () => {
      mockedListDrives.mockReturnValue(
        (async function* (): AsyncGenerator<GraphDrive> {
          throw new GraphTransientError('Graph unavailable');
        })(),
      );

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      const finalUpdate = scanJobs.updateById.mock.calls.at(-1);
      expect(finalUpdate?.[1]).toEqual(
        expect.objectContaining({ documentsScanned: 0, documentsFailed: 1, status: 'Failed' }),
      );
      expect(finalUpdate?.[1].errorSummary).toContain('Team Site');
    });

    it('isolates a single failing item so the rest of the site still gets persisted', async () => {
      const otherItem: GraphDriveItem = {
        ...fileItem,
        id: 'item-2',
        name: 'Other.docx',
      };
      mockedListDocuments.mockReturnValue(asyncGen([fileItem, otherItem]));
      documents.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        'graphItemId' in where ? [] : [],
      );
      documents.create.mockImplementation(async (data: { graphItemId: string }) => {
        if (data.graphItemId === 'item-2') throw new Error('unique constraint violation');
        return { id: 'doc-1', siteId: 'site-1', graphItemId: data.graphItemId };
      });

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      expect(documents.create).toHaveBeenCalledTimes(2); // both attempted
      const finalUpdate = scanJobs.updateById.mock.calls.at(-1);
      expect(finalUpdate?.[1]).toEqual(
        expect.objectContaining({ documentsScanned: 1, documentsFailed: 1, status: 'Completed' }),
      );
    });

    it('marks a previously-known document Removed once it no longer appears in the Graph enumeration', async () => {
      mockedListDocuments.mockReturnValue(asyncGen([fileItem])); // only item-1 present this run
      const staleDocument = { id: 'doc-stale', siteId: 'site-1', graphItemId: 'item-deleted', status: 'Active' };

      documents.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if ('graphItemId' in where) return []; // upsertDocument's existence check for item-1
        if ('siteId' in where) return [staleDocument]; // reconciliation's active-document listing
        return []; // scoreTenantDocuments
      });
      documents.create.mockResolvedValue({ id: 'doc-1', siteId: 'site-1', graphItemId: 'item-1' });

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      expect(documents.updateById).toHaveBeenCalledWith('doc-stale', { status: 'Removed' });
    });

    it('never marks a document Removed while enumeration itself failed (incomplete picture)', async () => {
      mockedListDocuments.mockReturnValue(
        (async function* (): AsyncGenerator<GraphDriveItem> {
          throw new GraphTransientError('Graph unavailable mid-enumeration');
        })(),
      );

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      expect(documents.updateById).not.toHaveBeenCalledWith(expect.anything(), { status: 'Removed' });
    });
  });

  describe('scoring after collection', () => {
    beforeEach(() => {
      scanJobs.findFirstById.mockResolvedValue({ id: 'scan-1', microsoftTenantId: 'tenant-1' });
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', entraTenantId: 'entra-1' });
      sharePointSites.findMany.mockResolvedValue([]); // nothing new to collect this run
    });

    it('scores every Active document for the tenant and sets it as the current health score', async () => {
      const scoredDocument = {
        id: 'doc-1',
        name: 'Employee Handbook.docx',
        sourceCreatedAt: new Date('2020-01-01'),
        sourceModifiedAt: new Date('2020-01-01'),
        sizeBytes: BigInt(2048),
      };
      documents.findMany.mockResolvedValue([scoredDocument]);
      healthScores.create.mockResolvedValue({ id: 'score-1' });

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      expect(healthScores.create).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'doc-1', scanJobId: 'scan-1' }),
      );
      expect(documents.updateById).toHaveBeenCalledWith('doc-1', { currentHealthScoreId: 'score-1' });
    });

    it('does nothing when the tenant has no Active documents', async () => {
      documents.findMany.mockResolvedValue([]);

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      expect(healthScores.create).not.toHaveBeenCalled();
    });
  });

  describe('progress tracking and snapshots (ADR-0015 §3/§5)', () => {
    const siteA = { id: 'site-a', graphSiteId: 'graph-a', displayName: 'Site A' };
    const siteB = { id: 'site-b', graphSiteId: 'graph-b', displayName: 'Site B' };

    beforeEach(() => {
      scanJobs.findFirstById.mockResolvedValue({ id: 'scan-1', microsoftTenantId: 'tenant-1' });
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', entraTenantId: 'entra-1' });
      sharePointSites.findMany.mockResolvedValue([siteA, siteB]);
      mockedListDrives.mockReturnValue(asyncGen([]));
      documents.findMany.mockResolvedValue([]);
    });

    it('reports totalSites once known, and progresses currentSiteName/sitesCompleted per site', async () => {
      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      const calls = scanJobs.updateById.mock.calls.map(([, data]) => data);
      expect(calls).toContainEqual({ totalSites: 2 });
      expect(calls).toContainEqual({ currentSiteName: 'Site A' });
      expect(calls).toContainEqual({ currentSiteName: 'Site B' });
      expect(calls).toContainEqual({ sitesCompleted: 1 });
      expect(calls).toContainEqual({ sitesCompleted: 2 });
      // Cleared once the loop finishes, regardless of final status.
      expect(calls).toContainEqual({ currentSiteName: null });
    });

    it('creates a HealthSnapshot with the tenant aggregate when the scan completes successfully', async () => {
      documents.findMany.mockResolvedValue([
        {
          id: 'doc-1',
          name: 'A.docx',
          sourceCreatedAt: new Date('2026-06-01'),
          sourceModifiedAt: new Date('2026-06-01'),
          sizeBytes: BigInt(100),
        },
        {
          id: 'doc-2',
          name: 'B.docx',
          sourceCreatedAt: new Date('2020-01-01'),
          sourceModifiedAt: new Date('2020-01-01'),
          sizeBytes: BigInt(200),
        },
      ]);
      healthScores.create.mockResolvedValueOnce({ id: 'score-1' }).mockResolvedValueOnce({ id: 'score-2' });

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      expect(healthSnapshots.create).toHaveBeenCalledWith(
        expect.objectContaining({
          scanJobId: 'scan-1',
          totalDocumentsScanned: 2,
          averageHealthScore: expect.any(Number),
          criticalIssuesCount: expect.any(Number),
          warningIssuesCount: expect.any(Number),
        }),
      );
    });

    it('does not create a HealthSnapshot when the scan ends Failed', async () => {
      mockedListDrives.mockReturnValue(
        (async function* (): AsyncGenerator<GraphDrive> {
          throw new GraphTransientError('boom');
        })(),
      );

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      expect(healthSnapshots.create).not.toHaveBeenCalled();
    });

    it('still creates a HealthSnapshot with zeroed values when the scan completes with nothing to score', async () => {
      documents.findMany.mockResolvedValue([]);

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      expect(healthSnapshots.create).toHaveBeenCalledWith(
        expect.objectContaining({ totalDocumentsScanned: 0, averageHealthScore: null }),
      );
    });
  });

  describe('worker-level failure observability', () => {
    it('logs a terminal job failure via the failed event (no trace beyond Redis otherwise)', () => {
      const logSpy = jest.spyOn((processor as unknown as { logger: { error: jest.Mock } }).logger, 'error');

      processor.onFailed(job({ organizationId: 'org-1', scanJobId: 'scan-1' }), new Error('boom'));

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('scan-1'), expect.anything());
    });
  });
});
