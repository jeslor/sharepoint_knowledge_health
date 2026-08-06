import { createTenantContext } from '@sph/database';
import { listDrives, listDocuments, listChildren, GraphTransientError, type GraphDrive, type GraphDriveItem } from '@sph/graph-client';
import type { Job } from 'bullmq';
import type { ScanJobPayload } from '@sph/types';
import { DocumentCollectorProcessor } from './document-collector.processor';

jest.mock('@sph/database');
jest.mock('@sph/graph-client');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;
const mockedListDrives = listDrives as jest.MockedFunction<typeof listDrives>;
const mockedListDocuments = listDocuments as jest.MockedFunction<typeof listDocuments>;
const mockedListChildren = listChildren as jest.MockedFunction<typeof listChildren>;

async function* asyncGen<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

function job(payload: ScanJobPayload): Job<ScanJobPayload> {
  return { data: payload } as Job<ScanJobPayload>;
}

describe('DocumentCollectorProcessor', () => {
  const reconciliationQueue = { add: jest.fn() };
  const processor = new DocumentCollectorProcessor(reconciliationQueue as never);

  const scanJobs = { findFirstById: jest.fn(), updateById: jest.fn() };
  const microsoftTenants = { findFirstById: jest.fn() };
  const sharePointSites = { findMany: jest.fn(), updateById: jest.fn() };
  const documents = { findMany: jest.fn(), create: jest.fn(), updateById: jest.fn() };
  const documentOwners = { findMany: jest.fn(), create: jest.fn(), deleteById: jest.fn() };
  const users = { findMany: jest.fn() };
  const healthScores = { create: jest.fn() };
  const healthIssues = { create: jest.fn() };
  const healthSnapshots = { create: jest.fn() };
  const governanceIssues = { findMany: jest.fn(), updateById: jest.fn() };
  const notifications = { create: jest.fn() };

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
      governanceIssues,
      notifications,
    } as never);

    // Defaults so tests only override what they care about.
    sharePointSites.findMany.mockResolvedValue([]);
    documents.findMany.mockResolvedValue([]);
    documentOwners.findMany.mockResolvedValue([]);
    users.findMany.mockResolvedValue([]);
    healthScores.create.mockResolvedValue({ id: 'score-1' });
    healthSnapshots.create.mockResolvedValue({ id: 'snapshot-1' });
    governanceIssues.findMany.mockResolvedValue([]);
    reconciliationQueue.add.mockResolvedValue(undefined);
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

    describe('removed-document governance signal (ADR-0021 §3.4)', () => {
      const staleDocument = { id: 'doc-stale', siteId: 'site-1', graphItemId: 'item-deleted', status: 'Active' };

      beforeEach(() => {
        mockedListDocuments.mockReturnValue(asyncGen([fileItem])); // only item-1 present this run
        documents.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
          if ('graphItemId' in where) return [];
          if ('siteId' in where) return [staleDocument];
          return [];
        });
        documents.create.mockResolvedValue({ id: 'doc-1', siteId: 'site-1', graphItemId: 'item-1' });
      });

      it('notifies the assignee of an Open/InProgress GovernanceIssue on a document that was just removed', async () => {
        governanceIssues.findMany.mockResolvedValue([
          { id: 'issue-1', documentId: 'doc-stale', issueType: 'Freshness', status: 'Open', assignedUserId: 'user-1' },
        ]);

        await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

        expect(governanceIssues.findMany).toHaveBeenCalledWith({
          where: { documentId: 'doc-stale', status: { in: ['Open', 'InProgress'] } },
        });
        expect(notifications.create).toHaveBeenCalledWith({
          userId: 'user-1',
          type: 'DocumentRemoved',
          message: expect.stringContaining('Freshness'),
          governanceIssueId: 'issue-1',
          documentId: 'doc-stale',
        });
      });

      it('skips an open issue with no assignedUserId — no resolvable recipient', async () => {
        governanceIssues.findMany.mockResolvedValue([
          { id: 'issue-1', documentId: 'doc-stale', issueType: 'Freshness', status: 'Open', assignedUserId: null },
        ]);

        await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

        expect(notifications.create).not.toHaveBeenCalled();
      });

      it('does not touch GovernanceIssue status — removal is never auto-resolution', async () => {
        governanceIssues.findMany.mockResolvedValue([
          { id: 'issue-1', documentId: 'doc-stale', issueType: 'Freshness', status: 'Open', assignedUserId: 'user-1' },
        ]);

        await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

        expect(governanceIssues.updateById).not.toHaveBeenCalled();
      });

      it('does not notify when the removed document has no Open/InProgress GovernanceIssue', async () => {
        governanceIssues.findMany.mockResolvedValue([]);

        await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

        expect(notifications.create).not.toHaveBeenCalled();
      });

      // Phase D.2 review fix (Issue 2): a notification failure must never
      // roll back the document's Removed transition, must never stop
      // remaining processing (other issues on the same document, or other
      // removed documents in the same site), and must be logged.
      describe('failure isolation', () => {
        it('still marks the document Removed even when notifying its assignee fails', async () => {
          governanceIssues.findMany.mockResolvedValue([
            { id: 'issue-1', documentId: 'doc-stale', issueType: 'Freshness', status: 'Open', assignedUserId: 'user-1' },
          ]);
          notifications.create.mockRejectedValue(new Error('DB connection lost'));

          await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

          expect(documents.updateById).toHaveBeenCalledWith('doc-stale', { status: 'Removed' });
        });

        it('still attempts a second issue on the same document after the first issue\'s notification fails', async () => {
          governanceIssues.findMany.mockResolvedValue([
            { id: 'issue-1', documentId: 'doc-stale', issueType: 'Freshness', status: 'Open', assignedUserId: 'user-1' },
            { id: 'issue-2', documentId: 'doc-stale', issueType: 'Ownership', status: 'Open', assignedUserId: 'user-2' },
          ]);
          notifications.create.mockRejectedValueOnce(new Error('DB connection lost')).mockResolvedValueOnce({ id: 'notification-2' });

          await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

          expect(notifications.create).toHaveBeenCalledTimes(2);
          expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ governanceIssueId: 'issue-2' }));
        });

        it('still processes a second removed document in the same site after the first one\'s notification fails', async () => {
          const staleDocument2 = { id: 'doc-stale-2', siteId: 'site-1', graphItemId: 'item-deleted-2', status: 'Active' };
          documents.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
            if ('graphItemId' in where) return [];
            if ('siteId' in where) return [staleDocument, staleDocument2];
            return [];
          });
          governanceIssues.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
            where.documentId === 'doc-stale'
              ? [{ id: 'issue-1', documentId: 'doc-stale', issueType: 'Freshness', status: 'Open', assignedUserId: 'user-1' }]
              : [{ id: 'issue-2', documentId: 'doc-stale-2', issueType: 'Freshness', status: 'Open', assignedUserId: 'user-2' }],
          );
          notifications.create.mockRejectedValueOnce(new Error('DB connection lost')).mockResolvedValueOnce({ id: 'notification-2' });

          await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

          expect(documents.updateById).toHaveBeenCalledWith('doc-stale', { status: 'Removed' });
          expect(documents.updateById).toHaveBeenCalledWith('doc-stale-2', { status: 'Removed' });
          expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ governanceIssueId: 'issue-2' }));
        });

        it('logs a notification failure via the processor logger', async () => {
          governanceIssues.findMany.mockResolvedValue([
            { id: 'issue-1', documentId: 'doc-stale', issueType: 'Freshness', status: 'Open', assignedUserId: 'user-1' },
          ]);
          notifications.create.mockRejectedValue(new Error('DB connection lost'));
          const logSpy = jest.spyOn((processor as unknown as { logger: { error: jest.Mock } }).logger, 'error');

          await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

          expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('issue-1'), expect.anything());
        });

        it('does not abort the whole scan or mark the site enumeration failed when a notification fails', async () => {
          governanceIssues.findMany.mockResolvedValue([
            { id: 'issue-1', documentId: 'doc-stale', issueType: 'Freshness', status: 'Open', assignedUserId: 'user-1' },
          ]);
          notifications.create.mockRejectedValue(new Error('DB connection lost'));

          await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

          const finalUpdate = scanJobs.updateById.mock.calls.at(-1);
          expect(finalUpdate?.[1]).toEqual(expect.objectContaining({ status: 'Completed' }));
        });
      });
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

    describe('recursive folder traversal (ADR-0020)', () => {
      function realFolder(id: string, name: string): GraphDriveItem {
        return {
          id,
          name,
          webUrl: `https://x/${name}`,
          size: 0,
          createdDateTime: '2026-01-01T00:00:00.000Z',
          lastModifiedDateTime: '2026-01-01T00:00:00.000Z',
          folder: { childCount: 1 },
          parentReference: { driveId: 'drive-1', path: '/drives/drive-1/root:' },
        };
      }

      function realFile(id: string, name: string, path: string): GraphDriveItem {
        return {
          id,
          name,
          webUrl: `https://x/${name}`,
          size: 1024,
          createdDateTime: '2026-01-01T00:00:00.000Z',
          lastModifiedDateTime: '2026-01-01T00:00:00.000Z',
          file: { mimeType: 'application/msword' },
          parentReference: { driveId: 'drive-1', path },
        };
      }

      const remoteFolderShortcut: GraphDriveItem = {
        id: 'shortcut-folder-1',
        name: 'Shared Folder (shortcut)',
        webUrl: 'https://x/Shared',
        size: 0,
        createdDateTime: '2026-01-01T00:00:00.000Z',
        lastModifiedDateTime: '2026-01-01T00:00:00.000Z',
        folder: { childCount: 5 },
        remoteItem: { id: 'remote-folder-target' },
        parentReference: { driveId: 'drive-1', path: '/drives/drive-1/root:' },
      };

      const remoteFileShortcut: GraphDriveItem = {
        id: 'shortcut-file-1',
        name: 'Shared Document (shortcut).docx',
        webUrl: 'https://x/Shared Document.docx',
        size: 4096,
        createdDateTime: '2026-01-01T00:00:00.000Z',
        lastModifiedDateTime: '2026-01-01T00:00:00.000Z',
        file: { mimeType: 'application/msword' },
        remoteItem: { id: 'remote-file-target' },
        parentReference: { driveId: 'drive-1', path: '/drives/drive-1/root:' },
      };

      beforeEach(() => {
        documents.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
          'graphItemId' in where ? [] : [],
        );
        documents.create.mockImplementation(async (data: { graphItemId: string }) => ({
          id: `doc-${data.graphItemId}`,
          siteId: 'site-1',
          graphItemId: data.graphItemId,
        }));
      });

      it('discovers and persists a document nested one level deep in a subfolder', async () => {
        const subfolder = realFolder('folder-1', 'Subfolder');
        const nestedFile = realFile('item-nested', 'Nested.docx', '/drives/drive-1/root:/Subfolder');

        mockedListDocuments.mockReturnValue(asyncGen([subfolder]));
        mockedListChildren.mockReturnValue(asyncGen([nestedFile]));

        await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

        expect(mockedListChildren).toHaveBeenCalledWith('entra-1', 'drive-1', 'folder-1');
        expect(documents.create).toHaveBeenCalledWith(expect.objectContaining({ graphItemId: 'item-nested' }));
      });

      it('recurses through multiple levels of nesting, not just one extra level', async () => {
        const level1 = realFolder('folder-1', 'Level1');
        const level2 = realFolder('folder-2', 'Level2');
        const deepFile = realFile('item-deep', 'Deep.docx', '/drives/drive-1/root:/Level1/Level2');

        mockedListDocuments.mockReturnValue(asyncGen([level1]));
        mockedListChildren.mockImplementation((_entraTenantId: string, _driveId: string, itemId: string) => {
          if (itemId === 'folder-1') return asyncGen([level2]);
          if (itemId === 'folder-2') return asyncGen([deepFile]);
          return asyncGen([]);
        });

        await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

        expect(mockedListChildren).toHaveBeenCalledWith('entra-1', 'drive-1', 'folder-1');
        expect(mockedListChildren).toHaveBeenCalledWith('entra-1', 'drive-1', 'folder-2');
        expect(documents.create).toHaveBeenCalledWith(expect.objectContaining({ graphItemId: 'item-deep' }));
      });

      it('never expands a remoteItem-faceted folder — the ADR-0014 trust-boundary proof', async () => {
        mockedListDocuments.mockReturnValue(asyncGen([remoteFolderShortcut]));

        await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

        expect(mockedListChildren).not.toHaveBeenCalled();
        expect(documents.create).not.toHaveBeenCalled();
      });

      it('never persists a remoteItem-faceted file, even though it carries a normal file facet', async () => {
        mockedListDocuments.mockReturnValue(asyncGen([remoteFileShortcut]));

        await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

        expect(documents.create).not.toHaveBeenCalled();
      });

      it('expands a folder only once even if Graph reports it twice (visited-set defense-in-depth)', async () => {
        const duplicated = realFolder('folder-dup', 'Duplicated');
        mockedListDocuments.mockReturnValue(asyncGen([duplicated, duplicated]));
        mockedListChildren.mockReturnValue(asyncGen([]));

        await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

        expect(mockedListChildren).toHaveBeenCalledTimes(1);
      });

      it('isolates a folder-expansion failure without aborting the rest of the traversal, and suppresses reconciliation for that site', async () => {
        const badFolder = realFolder('folder-bad', 'Bad');
        const goodFolder = realFolder('folder-good', 'Good');
        const goodFile = realFile('item-good', 'Good.docx', '/drives/drive-1/root:/Good');
        const staleDocument = { id: 'doc-stale', siteId: 'site-1', graphItemId: 'item-deleted', status: 'Active' };

        mockedListDocuments.mockReturnValue(asyncGen([badFolder, goodFolder]));
        mockedListChildren.mockImplementation((_entraTenantId: string, _driveId: string, itemId: string) => {
          if (itemId === 'folder-bad') {
            return (async function* (): AsyncGenerator<GraphDriveItem> {
              throw new GraphTransientError('Graph unavailable expanding folder-bad');
            })();
          }
          return asyncGen([goodFile]);
        });
        documents.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
          if ('graphItemId' in where) return [];
          if ('siteId' in where) return [staleDocument]; // reconciliation's active-document listing, if it ran
          return [];
        });

        await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

        // The good folder's file still gets persisted despite the bad folder's failure.
        expect(documents.create).toHaveBeenCalledWith(expect.objectContaining({ graphItemId: 'item-good' }));
        // Reconciliation must not run against an incomplete picture (ADR-0004, extended by ADR-0020 §4).
        expect(documents.updateById).not.toHaveBeenCalledWith(expect.anything(), { status: 'Removed' });
        const finalUpdate = scanJobs.updateById.mock.calls.at(-1);
        expect(finalUpdate?.[1]).toEqual(expect.objectContaining({ documentsFailed: 1 }));
      });
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
        nextReviewDueAt: null,
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

    // ADR-0002 amendment (accepted 2026-07-23): hasReviewDate is no longer a
    // hardcoded constant — it derives from Document.nextReviewDueAt, set
    // only via PATCH .../documents/:documentId/review.
    describe('ReviewStatus scoring input (ADR-0002 amendment)', () => {
      const baseDocument = {
        id: 'doc-1',
        name: 'Employee Handbook.docx',
        sourceCreatedAt: new Date('2020-01-01'),
        sourceModifiedAt: new Date('2020-01-01'),
        sizeBytes: BigInt(2048),
      };

      it('fails ReviewStatus (score 0, RequiresReview issue) when nextReviewDueAt is null', async () => {
        documents.findMany.mockResolvedValue([{ ...baseDocument, nextReviewDueAt: null }]);
        healthScores.create.mockResolvedValue({ id: 'score-1' });

        await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

        expect(healthScores.create).toHaveBeenCalledWith(expect.objectContaining({ reviewStatusScore: 0 }));
        expect(healthIssues.create).toHaveBeenCalledWith(
          expect.objectContaining({ healthScoreId: 'score-1', criterion: 'ReviewStatus', severity: 'RequiresReview' }),
        );
      });

      it('passes ReviewStatus (score 100, no issue) when nextReviewDueAt is set', async () => {
        documents.findMany.mockResolvedValue([{ ...baseDocument, nextReviewDueAt: new Date('2026-12-01') }]);
        healthScores.create.mockResolvedValue({ id: 'score-1' });

        await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

        expect(healthScores.create).toHaveBeenCalledWith(expect.objectContaining({ reviewStatusScore: 100 }));
        expect(healthIssues.create).not.toHaveBeenCalledWith(
          expect.objectContaining({ criterion: 'ReviewStatus' }),
        );
      });
    });
  });

  // F3 fix regression tests: Document.currentHealthScoreId must only be
  // repointed when the overall scan succeeds. HealthScore/HealthIssue
  // history is unaffected either way — only the "current" promotion step
  // is gated.
  describe('currentHealthScoreId promotion is gated on scan success (F3)', () => {
    beforeEach(() => {
      scanJobs.findFirstById.mockResolvedValue({ id: 'scan-1', microsoftTenantId: 'tenant-1' });
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', entraTenantId: 'entra-1' });
    });

    it('a Failed scan (every site failed to collect) still writes HealthScore/HealthIssue history, but never promotes currentHealthScoreId', async () => {
      sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', graphSiteId: 'graph-site-1', displayName: 'Team Site' }]);
      mockedListDrives.mockReturnValue(
        (async function* (): AsyncGenerator<GraphDrive> {
          throw new GraphTransientError('Graph unavailable');
        })(),
      );
      const previouslyScoredDocument = {
        id: 'doc-1',
        name: 'Employee Handbook.docx',
        sourceCreatedAt: new Date('2020-01-01'),
        sourceModifiedAt: new Date('2020-01-01'),
        sizeBytes: BigInt(2048),
        nextReviewDueAt: null,
        currentHealthScoreId: 'score-previous', // already has a current score from an earlier successful scan
      };
      documents.findMany.mockResolvedValue([previouslyScoredDocument]);
      healthScores.create.mockResolvedValue({ id: 'score-new' });

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      const finalUpdate = scanJobs.updateById.mock.calls.at(-1);
      expect(finalUpdate?.[1]).toEqual(expect.objectContaining({ status: 'Failed' }));

      // History is preserved regardless of outcome.
      expect(healthScores.create).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'doc-1', scanJobId: 'scan-1' }));

      // But the "current" pointer is never touched by a Failed scan.
      expect(documents.updateById).not.toHaveBeenCalledWith('doc-1', { currentHealthScoreId: expect.anything() });
    });

    it('a Failed first-ever scan for a tenant never sets a currentHealthScoreId pointer at all', async () => {
      sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', graphSiteId: 'graph-site-1', displayName: 'Team Site' }]);
      mockedListDrives.mockReturnValue(
        (async function* (): AsyncGenerator<GraphDrive> {
          throw new GraphTransientError('Graph unavailable');
        })(),
      );
      const neverScoredDocument = {
        id: 'doc-1',
        name: 'New Document.docx',
        sourceCreatedAt: new Date('2026-01-01'),
        sourceModifiedAt: new Date('2026-01-01'),
        sizeBytes: BigInt(1024),
        nextReviewDueAt: null,
        currentHealthScoreId: null,
      };
      documents.findMany.mockResolvedValue([neverScoredDocument]);
      healthScores.create.mockResolvedValue({ id: 'score-1' });

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      expect(documents.updateById).not.toHaveBeenCalledWith(expect.anything(), { currentHealthScoreId: expect.anything() });
    });

    it('a partial item failure that still leaves documentsScanned > 0 keeps status Completed and still promotes — unchanged existing behavior', async () => {
      const drive: GraphDrive = { id: 'drive-1', name: 'Documents', webUrl: 'https://x/drive', driveType: 'documentLibrary' };
      const okItem: GraphDriveItem = {
        id: 'item-ok',
        name: 'Ok.docx',
        webUrl: 'https://x/Ok.docx',
        size: 100,
        createdDateTime: '2026-01-01T00:00:00.000Z',
        lastModifiedDateTime: '2026-01-01T00:00:00.000Z',
        file: { mimeType: 'application/msword' },
        parentReference: { driveId: 'drive-1', path: '/drives/drive-1/root:' },
      };
      const badItem: GraphDriveItem = { ...okItem, id: 'item-bad', name: 'Bad.docx' };
      const createdDoc = {
        id: 'doc-ok',
        siteId: 'site-1',
        graphItemId: 'item-ok',
        name: 'Ok.docx',
        sourceCreatedAt: new Date('2026-01-01'),
        sourceModifiedAt: new Date('2026-01-01'),
        sizeBytes: BigInt(100),
        nextReviewDueAt: null,
      };

      sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', graphSiteId: 'graph-site-1', displayName: 'Team Site' }]);
      mockedListDrives.mockReturnValue(asyncGen([drive]));
      mockedListDocuments.mockReturnValue(asyncGen([okItem, badItem]));
      documents.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if ('graphItemId' in where) return []; // upsert existence check — both items are new
        if ('siteId' in where) return []; // reconciliation — nothing stale
        return [createdDoc]; // scoring pass
      });
      documents.create.mockImplementation(async (data: { graphItemId: string }) => {
        if (data.graphItemId === 'item-bad') throw new Error('unique constraint violation');
        return createdDoc;
      });
      healthScores.create.mockResolvedValue({ id: 'score-new' });

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      const finalUpdate = scanJobs.updateById.mock.calls.at(-1);
      expect(finalUpdate?.[1]).toEqual(expect.objectContaining({ status: 'Completed', documentsScanned: 1, documentsFailed: 1 }));
      expect(documents.updateById).toHaveBeenCalledWith('doc-ok', { currentHealthScoreId: 'score-new' });
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

  describe('notification reconciliation trigger (ADR-0021 §3.3)', () => {
    beforeEach(() => {
      scanJobs.findFirstById.mockResolvedValue({ id: 'scan-1', microsoftTenantId: 'tenant-1' });
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', entraTenantId: 'entra-1' });
      sharePointSites.findMany.mockResolvedValue([]);
      documents.findMany.mockResolvedValue([]);
    });

    it('enqueues a reconciliation job for the organization once the scan completes', async () => {
      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      expect(reconciliationQueue.add).toHaveBeenCalledWith('reconcile-org', { organizationId: 'org-1' });
    });

    it('never enqueues a reconciliation job when the scan ends Failed', async () => {
      mockedListDrives.mockReturnValue(
        (async function* (): AsyncGenerator<GraphDrive> {
          throw new GraphTransientError('boom');
        })(),
      );
      sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', graphSiteId: 'graph-site-1', displayName: 'Team Site' }]);

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      expect(reconciliationQueue.add).not.toHaveBeenCalled();
    });

    it('does not fail the scan job when the reconciliation enqueue itself fails', async () => {
      reconciliationQueue.add.mockRejectedValue(new Error('Redis unavailable'));

      await processor.process(job({ organizationId: 'org-1', scanJobId: 'scan-1' }));

      const finalUpdate = scanJobs.updateById.mock.calls.at(-1);
      expect(finalUpdate?.[1]).toEqual(expect.objectContaining({ status: 'Completed' }));
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
