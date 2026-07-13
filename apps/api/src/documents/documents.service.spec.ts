import { createTenantContext } from '@sph/database';
import { DocumentsService } from './documents.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('DocumentsService', () => {
  const service = new DocumentsService();

  const documents = { findMany: jest.fn(), count: jest.fn(), findFirstById: jest.fn() };
  const healthScores = { findMany: jest.fn() };
  const healthIssues = { findMany: jest.fn() };
  const sharePointSites = { findMany: jest.fn() };
  const documentOwners = { findMany: jest.fn(), create: jest.fn(), deleteById: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({
      documents,
      healthScores,
      healthIssues,
      sharePointSites,
      documentOwners,
    } as never);

    // Sane defaults so each test only overrides what it cares about.
    documents.findMany.mockResolvedValue([]);
    documents.count.mockResolvedValue(0);
    healthScores.findMany.mockResolvedValue([]);
    healthIssues.findMany.mockResolvedValue([]);
    sharePointSites.findMany.mockResolvedValue([]);
    documentOwners.findMany.mockResolvedValue([]);
  });

  describe('listDocuments', () => {
    it('serializes BigInt sizeBytes to a string (JSON.stringify cannot serialize bigint)', async () => {
      documents.findMany.mockResolvedValue([
        {
          id: 'doc-1',
          siteId: 'site-1',
          graphItemId: 'item-1',
          name: 'Handbook.docx',
          path: '/Handbook.docx',
          fileType: 'application/msword',
          sizeBytes: BigInt(123456),
          sourceCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
          sourceModifiedAt: new Date('2026-06-01T00:00:00.000Z'),
          status: 'Active',
          currentHealthScoreId: null,
          ingestedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ]);

      const results = await service.listDocuments('org-1');
      expect(results).toHaveLength(1);
      const [result] = results;

      expect(result?.sizeBytes).toBe('123456');
      expect(typeof result?.sizeBytes).toBe('string');
      expect(() => JSON.stringify(result)).not.toThrow();
    });
  });

  describe('getDocument', () => {
    const baseDocument = {
      id: 'doc-1',
      siteId: 'site-1',
      name: 'Employee Handbook.docx',
      path: '/Handbook.docx',
      fileType: 'application/msword',
      sizeBytes: BigInt(2048),
      status: 'Active',
      sourceCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
      sourceModifiedAt: new Date('2026-06-01T00:00:00.000Z'),
      currentHealthScoreId: 'score-1',
    };

    it('returns null when the document does not exist for this organization (org isolation)', async () => {
      documents.findFirstById.mockResolvedValue(null);

      const result = await service.getDocument('org-1', 'doc-from-another-org');

      expect(result).toBeNull();
    });

    it('returns full metadata, owner, and health for a scored document', async () => {
      documents.findFirstById.mockResolvedValue(baseDocument);
      sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);
      documentOwners.findMany.mockResolvedValue([{ displayName: 'Alice', email: 'alice@example.com' }]);
      healthScores.findMany.mockResolvedValue([
        { id: 'score-1', compositeScore: 42, healthBand: 'RequiresReview', calculatedAt: new Date('2026-07-01T00:00:00.000Z') },
      ]);
      healthIssues.findMany.mockResolvedValue([
        { criterion: 'ReviewStatus', severity: 'RequiresReview', message: 'Missing review date' },
      ]);

      const result = await service.getDocument('org-1', 'doc-1');

      expect(result).toEqual({
        documentId: 'doc-1',
        documentName: 'Employee Handbook.docx',
        siteId: 'site-1',
        siteName: 'Team Site',
        path: '/Handbook.docx',
        fileType: 'application/msword',
        sizeBytes: '2048',
        owner: 'Alice',
        ownerEmail: 'alice@example.com',
        status: 'Active',
        sourceCreatedAt: '2026-01-01T00:00:00.000Z',
        sourceModifiedAt: '2026-06-01T00:00:00.000Z',
        score: 42,
        band: 'RequiresReview',
        calculatedAt: '2026-07-01T00:00:00.000Z',
        issues: [{ type: 'ReviewStatus', severity: 'RequiresReview', message: 'Missing review date' }],
      });
    });

    it('returns null score/band/issues for a document never scored yet', async () => {
      documents.findFirstById.mockResolvedValue({ ...baseDocument, currentHealthScoreId: null });
      sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);

      const result = await service.getDocument('org-1', 'doc-1');

      expect(result?.score).toBeNull();
      expect(result?.band).toBeNull();
      expect(result?.issues).toEqual([]);
    });

    it('returns a null owner when no DocumentOwner row exists', async () => {
      documents.findFirstById.mockResolvedValue({ ...baseDocument, currentHealthScoreId: null });
      sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);
      documentOwners.findMany.mockResolvedValue([]);

      const result = await service.getDocument('org-1', 'doc-1');

      expect(result?.owner).toBeNull();
      expect(result?.ownerEmail).toBeNull();
    });
  });

  describe('getDocumentHistory', () => {
    it('returns null when the document does not exist for this organization (org isolation)', async () => {
      documents.findFirstById.mockResolvedValue(null);

      const result = await service.getDocumentHistory('org-1', 'doc-from-another-org');

      expect(result).toBeNull();
    });

    it('returns every HealthScore for the document, oldest first, without recalculating anything', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1' });
      healthScores.findMany.mockResolvedValue([
        { compositeScore: 60, healthBand: 'Fair', calculatedAt: new Date('2026-06-01T00:00:00.000Z') },
        { compositeScore: 85, healthBand: 'Good', calculatedAt: new Date('2026-07-01T00:00:00.000Z') },
      ]);

      const result = await service.getDocumentHistory('org-1', 'doc-1');

      expect(healthScores.findMany).toHaveBeenCalledWith({
        where: { documentId: 'doc-1' },
        orderBy: { calculatedAt: 'asc' },
      });
      expect(result).toEqual({
        documentId: 'doc-1',
        points: [
          { calculatedAt: '2026-06-01T00:00:00.000Z', score: 60, band: 'Fair' },
          { calculatedAt: '2026-07-01T00:00:00.000Z', score: 85, band: 'Good' },
        ],
      });
    });

    it('returns an empty points array for a document that has never been scored', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1' });
      healthScores.findMany.mockResolvedValue([]);

      const result = await service.getDocumentHistory('org-1', 'doc-1');

      expect(result?.points).toEqual([]);
    });
  });

  describe('listOwners', () => {
    it('returns null when the document does not exist for this organization', async () => {
      documents.findFirstById.mockResolvedValue(null);
      const result = await service.listOwners('org-1', 'doc-from-another-org');
      expect(result).toBeNull();
    });

    it('returns every DocumentOwner row regardless of source', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1' });
      documentOwners.findMany.mockResolvedValue([
        { id: 'owner-1', ownerType: 'Author', displayName: 'Alice', email: 'alice@example.com', source: 'GraphMetadata', assignedByUserId: null, assignedAt: null },
        { id: 'owner-2', ownerType: 'AssignedOwner', displayName: 'Sarah', email: 'sarah@example.com', source: 'ManualAssignment', assignedByUserId: 'admin-1', assignedAt: new Date('2026-07-01T00:00:00.000Z') },
      ]);

      const result = await service.listOwners('org-1', 'doc-1');

      expect(result).toEqual([
        { id: 'owner-1', ownerType: 'Author', displayName: 'Alice', email: 'alice@example.com', source: 'GraphMetadata', assignedByUserId: null, assignedAt: null },
        { id: 'owner-2', ownerType: 'AssignedOwner', displayName: 'Sarah', email: 'sarah@example.com', source: 'ManualAssignment', assignedByUserId: 'admin-1', assignedAt: '2026-07-01T00:00:00.000Z' },
      ]);
    });
  });

  describe('assignOwner', () => {
    it('returns null when the document does not exist for this organization', async () => {
      documents.findFirstById.mockResolvedValue(null);
      const result = await service.assignOwner('org-1', 'doc-missing', 'admin-1', { displayName: 'Sarah' });
      expect(result).toBeNull();
    });

    it('always creates a ManualAssignment / AssignedOwner row, stamped with the assigning user and now (ADR-0016 §4.2)', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1' });
      documentOwners.create.mockResolvedValue({
        id: 'owner-new',
        ownerType: 'AssignedOwner',
        displayName: 'Sarah',
        email: 'sarah@example.com',
        source: 'ManualAssignment',
        assignedByUserId: 'admin-1',
        assignedAt: new Date('2026-07-01T00:00:00.000Z'),
      });

      await service.assignOwner('org-1', 'doc-1', 'admin-1', { displayName: 'Sarah', email: 'sarah@example.com' });

      expect(documentOwners.create).toHaveBeenCalledWith({
        documentId: 'doc-1',
        ownerType: 'AssignedOwner',
        displayName: 'Sarah',
        email: 'sarah@example.com',
        source: 'ManualAssignment',
        assignedByUserId: 'admin-1',
        assignedAt: expect.any(Date),
      });
    });
  });

  describe('removeOwner', () => {
    it('throws NotFoundException when the owner does not exist for this document/organization', async () => {
      documentOwners.findMany.mockResolvedValue([]);
      await expect(service.removeOwner('org-1', 'doc-1', 'owner-missing')).rejects.toThrow('Document owner not found');
    });

    it('throws ConflictException and never deletes a GraphMetadata-sourced owner (ADR-0016 §4.2 — worker-owned)', async () => {
      documentOwners.findMany.mockResolvedValue([{ id: 'owner-1', source: 'GraphMetadata' }]);

      await expect(service.removeOwner('org-1', 'doc-1', 'owner-1')).rejects.toThrow(
        'Only a manually assigned owner can be removed',
      );
      expect(documentOwners.deleteById).not.toHaveBeenCalled();
    });

    it('deletes a ManualAssignment-sourced owner', async () => {
      documentOwners.findMany.mockResolvedValue([{ id: 'owner-2', source: 'ManualAssignment' }]);

      await service.removeOwner('org-1', 'doc-1', 'owner-2');

      expect(documentOwners.deleteById).toHaveBeenCalledWith('owner-2');
    });
  });

  describe('listDocumentHealth', () => {
    it('returns an empty page when no document has a current health score', async () => {
      const result = await service.listDocumentHealth('org-1', {});

      expect(result).toEqual({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });
      expect(healthScores.findMany).not.toHaveBeenCalled();
    });

    it('joins each document to its site, owner, health score, and issues without N+1 per-document queries', async () => {
      documents.findMany.mockResolvedValue([
        { id: 'doc-1', name: 'Employee Handbook.docx', siteId: 'site-1', status: 'Active', sourceModifiedAt: new Date('2026-06-01T00:00:00.000Z'), currentHealthScoreId: 'score-1' },
      ]);
      documents.count.mockResolvedValue(1);
      healthScores.findMany.mockResolvedValue([
        { id: 'score-1', compositeScore: 42, healthBand: 'RequiresReview', calculatedAt: new Date('2026-07-01T00:00:00.000Z') },
      ]);
      healthIssues.findMany.mockResolvedValue([
        { healthScoreId: 'score-1', criterion: 'ReviewStatus', severity: 'RequiresReview', message: 'Missing review date' },
      ]);
      sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);
      documentOwners.findMany.mockResolvedValue([{ documentId: 'doc-1', displayName: 'Alice', email: 'alice@example.com' }]);

      const result = await service.listDocumentHealth('org-1', {});

      expect(healthScores.findMany).toHaveBeenCalledTimes(1);
      expect(healthIssues.findMany).toHaveBeenCalledTimes(1);
      expect(sharePointSites.findMany).toHaveBeenCalledTimes(1);
      expect(documentOwners.findMany).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual([
        {
          documentId: 'doc-1',
          documentName: 'Employee Handbook.docx',
          siteId: 'site-1',
          siteName: 'Team Site',
          owner: 'Alice',
          status: 'Active',
          lastModifiedAt: '2026-06-01T00:00:00.000Z',
          score: 42,
          band: 'RequiresReview',
          issueCount: 1,
          calculatedAt: '2026-07-01T00:00:00.000Z',
          issues: [{ type: 'ReviewStatus', severity: 'RequiresReview', message: 'Missing review date' }],
        },
      ]);
      expect(result.pagination).toEqual({ page: 1, pageSize: 25, total: 1, totalPages: 1 });
    });

    it('skips a document whose currentHealthScoreId points at a score that no longer resolves', async () => {
      documents.findMany.mockResolvedValue([{ id: 'doc-1', name: 'Orphan.docx', siteId: 'site-1', currentHealthScoreId: 'score-missing' }]);
      documents.count.mockResolvedValue(1);

      const result = await service.listDocumentHealth('org-1', {});

      expect(result.data).toEqual([]);
    });

    it('applies default pagination (page 1, pageSize 25) and sorts by score ascending by default', async () => {
      await service.listDocumentHealth('org-1', {});

      expect(documents.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { currentHealthScore: { compositeScore: 'asc' } },
          skip: 0,
          take: 25,
        }),
      );
    });

    it('pushes page/pageSize into skip/take', async () => {
      await service.listDocumentHealth('org-1', { page: 3, pageSize: 10 });

      expect(documents.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    });

    it('sorts by name/lastModified when requested', async () => {
      await service.listDocumentHealth('org-1', { sortBy: 'name', sortDir: 'desc' });
      expect(documents.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { name: 'desc' } }));

      await service.listDocumentHealth('org-1', { sortBy: 'lastModified', sortDir: 'desc' });
      expect(documents.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { sourceModifiedAt: 'desc' } }));
    });

    it('filters by siteId, score range, and severity via the where clause', async () => {
      await service.listDocumentHealth('org-1', { siteId: 'site-9', minScore: 10, maxScore: 50, severity: 'RequiresReview' });

      expect(documents.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            siteId: 'site-9',
            currentHealthScore: { is: { compositeScore: { gte: 10, lte: 50 }, healthIssues: { some: { severity: 'RequiresReview' } } } },
          }),
        }),
      );
    });
  });
});
