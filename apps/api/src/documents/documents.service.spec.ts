import { createTenantContext } from '@sph/database';
import type { GovernanceActivityService } from '../governance/governance-activity.service';
import { DocumentsService } from './documents.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('DocumentsService', () => {
  const governanceActivityService = { record: jest.fn() };
  const service = new DocumentsService(governanceActivityService as unknown as GovernanceActivityService);

  const documents = { findMany: jest.fn(), count: jest.fn(), findFirstById: jest.fn(), updateById: jest.fn() };
  const healthScores = { findMany: jest.fn() };
  const healthIssues = { findMany: jest.fn() };
  const sharePointSites = { findMany: jest.fn() };
  const documentOwners = { findMany: jest.fn(), create: jest.fn(), deleteById: jest.fn() };
  const users = { findMany: jest.fn() };
  const sharePointReviewDateMappings = { findByLibrary: jest.fn() };
  const sharePointClassificationFields = { findManyActiveByLibrary: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({
      documents,
      healthScores,
      healthIssues,
      sharePointSites,
      documentOwners,
      users,
      sharePointReviewDateMappings,
      sharePointClassificationFields,
    } as never);

    // Sane defaults so each test only overrides what it cares about.
    documents.findMany.mockResolvedValue([]);
    documents.count.mockResolvedValue(0);
    healthScores.findMany.mockResolvedValue([]);
    healthIssues.findMany.mockResolvedValue([]);
    sharePointSites.findMany.mockResolvedValue([]);
    documentOwners.findMany.mockResolvedValue([]);
    users.findMany.mockResolvedValue([]);
    sharePointReviewDateMappings.findByLibrary.mockResolvedValue(null);
    sharePointClassificationFields.findManyActiveByLibrary.mockResolvedValue([]);
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
      nextReviewDueAt: null,
      reviewDateSource: 'Manual',
      webUrl: null,
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
        nextReviewDueAt: null,
        reviewDateSource: 'Manual',
        reviewDateColumnDisplayName: null,
        sharePointManaged: false,
        sharePointManagedColumnDisplayName: null,
        reviewDateHealth: 'Missing',
        taxonomyCoverage: { state: 'notYetScored', score: null, configuredFieldCount: 0 },
        webUrl: null,
      });
    });

    it('exposes nextReviewDueAt, reviewDateSource, and webUrl straight off the already-fetched Document row (no extra query)', async () => {
      documents.findFirstById.mockResolvedValue({
        ...baseDocument,
        currentHealthScoreId: null,
        nextReviewDueAt: new Date('2026-12-01T00:00:00.000Z'),
        reviewDateSource: 'Manual',
        webUrl: 'https://contoso.sharepoint.com/sites/finance/Handbook.docx',
      });
      sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);

      const result = await service.getDocument('org-1', 'doc-1');

      expect(result?.nextReviewDueAt).toBe('2026-12-01T00:00:00.000Z');
      expect(result?.reviewDateSource).toBe('Manual');
      expect(result?.webUrl).toBe('https://contoso.sharepoint.com/sites/finance/Handbook.docx');
    });

    it('returns nextReviewDueAt: null and webUrl: null for a document that has not received either field yet', async () => {
      documents.findFirstById.mockResolvedValue({ ...baseDocument, currentHealthScoreId: null });
      sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);

      const result = await service.getDocument('org-1', 'doc-1');

      expect(result?.nextReviewDueAt).toBeNull();
      expect(result?.webUrl).toBeNull();
    });

    describe('reviewDateColumnDisplayName (Phase 2 — Manual vs SharePoint source indicator)', () => {
      it('resolves the confirmed column display name when the source is GraphMetadata and a mapping exists', async () => {
        documents.findFirstById.mockResolvedValue({
          ...baseDocument,
          currentHealthScoreId: null,
          graphListId: 'list-1',
          reviewDateSource: 'GraphMetadata',
        });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);
        sharePointReviewDateMappings.findByLibrary.mockResolvedValue({
          status: 'Active',
          columnDisplayNameAtConfirmation: 'Review Date',
        });

        const result = await service.getDocument('org-1', 'doc-1');

        expect(result?.reviewDateColumnDisplayName).toBe('Review Date');
        expect(sharePointReviewDateMappings.findByLibrary).toHaveBeenCalledWith('site-1', 'list-1');
      });

      it('returns null when the source is Manual, even though a mapping lookup now still runs for sharePointManaged (Phase 3A-1)', async () => {
        documents.findFirstById.mockResolvedValue({
          ...baseDocument,
          currentHealthScoreId: null,
          graphListId: 'list-1',
          reviewDateSource: 'Manual',
        });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);
        sharePointReviewDateMappings.findByLibrary.mockResolvedValue({
          status: 'Active',
          columnDisplayNameAtConfirmation: 'Review Date',
        });

        const result = await service.getDocument('org-1', 'doc-1');

        // reviewDateColumnDisplayName's own contract is unchanged — still
        // gated strictly on reviewDateSource, regardless of what the
        // (now-unconditional) mapping lookup finds.
        expect(result?.reviewDateColumnDisplayName).toBeNull();
        // sharePointManagedColumnDisplayName is the new field that DOES
        // reflect the mapping in this state — see the dedicated describe
        // block below.
        expect(result?.sharePointManaged).toBe(true);
        expect(result?.sharePointManagedColumnDisplayName).toBe('Review Date');
      });

      it('returns null when the source is GraphMetadata but the document has no graphListId (never rescanned since Phase 1a)', async () => {
        documents.findFirstById.mockResolvedValue({
          ...baseDocument,
          currentHealthScoreId: null,
          graphListId: null,
          reviewDateSource: 'GraphMetadata',
        });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);

        const result = await service.getDocument('org-1', 'doc-1');

        expect(result?.reviewDateColumnDisplayName).toBeNull();
        expect(sharePointReviewDateMappings.findByLibrary).not.toHaveBeenCalled();
      });

      it('returns null when the source is GraphMetadata but no mapping resolves for the library', async () => {
        documents.findFirstById.mockResolvedValue({
          ...baseDocument,
          currentHealthScoreId: null,
          graphListId: 'list-1',
          reviewDateSource: 'GraphMetadata',
        });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);
        sharePointReviewDateMappings.findByLibrary.mockResolvedValue(null);

        const result = await service.getDocument('org-1', 'doc-1');

        expect(result?.reviewDateColumnDisplayName).toBeNull();
      });
    });

    describe('sharePointManaged / sharePointManagedColumnDisplayName (Phase 3A-1)', () => {
      it('is true with the column name populated when the library has an Active mapping, regardless of this document\'s own reviewDateSource', async () => {
        documents.findFirstById.mockResolvedValue({
          ...baseDocument,
          currentHealthScoreId: null,
          graphListId: 'list-1',
          reviewDateSource: 'Manual', // this document hasn't synced yet
        });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);
        sharePointReviewDateMappings.findByLibrary.mockResolvedValue({
          status: 'Active',
          columnDisplayNameAtConfirmation: 'Review Date',
        });

        const result = await service.getDocument('org-1', 'doc-1');

        expect(result?.sharePointManaged).toBe(true);
        expect(result?.sharePointManagedColumnDisplayName).toBe('Review Date');
      });

      it('is false when the mapping is Stale — manual editing is not blocked while SharePoint cannot currently provide a value', async () => {
        documents.findFirstById.mockResolvedValue({
          ...baseDocument,
          currentHealthScoreId: null,
          graphListId: 'list-1',
          reviewDateSource: 'GraphMetadata',
        });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);
        sharePointReviewDateMappings.findByLibrary.mockResolvedValue({
          status: 'Stale',
          columnDisplayNameAtConfirmation: 'Review Date',
        });

        const result = await service.getDocument('org-1', 'doc-1');

        expect(result?.sharePointManaged).toBe(false);
        expect(result?.sharePointManagedColumnDisplayName).toBeNull();
      });

      it('is false with no lookup at all when the document has no graphListId', async () => {
        documents.findFirstById.mockResolvedValue({ ...baseDocument, currentHealthScoreId: null, graphListId: null });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);

        const result = await service.getDocument('org-1', 'doc-1');

        expect(result?.sharePointManaged).toBe(false);
        expect(result?.sharePointManagedColumnDisplayName).toBeNull();
        expect(sharePointReviewDateMappings.findByLibrary).not.toHaveBeenCalled();
      });

      it('is false when no mapping exists for the library at all', async () => {
        documents.findFirstById.mockResolvedValue({ ...baseDocument, currentHealthScoreId: null, graphListId: 'list-1' });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);
        sharePointReviewDateMappings.findByLibrary.mockResolvedValue(null);

        const result = await service.getDocument('org-1', 'doc-1');

        expect(result?.sharePointManaged).toBe(false);
        expect(result?.sharePointManagedColumnDisplayName).toBeNull();
      });
    });

    // Phase 3A-1 (ADR-0002 amendment): getDocument computes reviewDateHealth
    // via @sph/scoring's classifyReviewDateHealth against the real system
    // clock — pinned here with fake timers (matching the existing
    // governance-issues.service.spec.ts / governance-analytics.service.spec.ts
    // convention) rather than asserting against whatever `now` happens to be
    // when this test suite runs.
    describe('reviewDateHealth (Phase 3A-1)', () => {
      const NOW = new Date('2026-08-19T00:00:00.000Z');

      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(NOW);
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('is Missing when nextReviewDueAt is null', async () => {
        documents.findFirstById.mockResolvedValue({ ...baseDocument, currentHealthScoreId: null, nextReviewDueAt: null });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);

        const result = await service.getDocument('org-1', 'doc-1');

        expect(result?.reviewDateHealth).toBe('Missing');
      });

      it('is Overdue when nextReviewDueAt is in the past', async () => {
        documents.findFirstById.mockResolvedValue({
          ...baseDocument,
          currentHealthScoreId: null,
          nextReviewDueAt: new Date('2026-08-01T00:00:00.000Z'),
        });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);

        const result = await service.getDocument('org-1', 'doc-1');

        expect(result?.reviewDateHealth).toBe('Overdue');
      });

      it('is DueSoon when nextReviewDueAt falls within the configured window', async () => {
        documents.findFirstById.mockResolvedValue({
          ...baseDocument,
          currentHealthScoreId: null,
          nextReviewDueAt: new Date('2026-08-25T00:00:00.000Z'), // 6 days out
        });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);

        const result = await service.getDocument('org-1', 'doc-1');

        expect(result?.reviewDateHealth).toBe('DueSoon');
      });

      it('is Healthy when nextReviewDueAt is outside the Due Soon window', async () => {
        documents.findFirstById.mockResolvedValue({
          ...baseDocument,
          currentHealthScoreId: null,
          nextReviewDueAt: new Date('2026-12-01T00:00:00.000Z'),
        });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);

        const result = await service.getDocument('org-1', 'doc-1');

        expect(result?.reviewDateHealth).toBe('Healthy');
      });
    });

    // ADR-0025: the three taxonomy presentation states must be
    // distinguishable — a neutral 100 (unconfigured) is never shown as
    // measured coverage, and an unscored row is distinct from both.
    describe('taxonomyCoverage (ADR-0025)', () => {
      it('is notYetScored when the document has no measured taxonomyScore', async () => {
        documents.findFirstById.mockResolvedValue({ ...baseDocument, graphListId: 'list-1', currentHealthScoreId: 'score-1' });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);
        healthScores.findMany.mockResolvedValue([{ id: 'score-1', compositeScore: 80, healthBand: 'NeedsAttention', taxonomyScore: null, calculatedAt: new Date() }]);
        sharePointClassificationFields.findManyActiveByLibrary.mockResolvedValue([{ id: 'f1' }]);

        const result = await service.getDocument('org-1', 'doc-1');

        expect(result?.taxonomyCoverage).toEqual({ state: 'notYetScored', score: null, configuredFieldCount: 1 });
      });

      it('is notConfigured when measured but the library has no active classification fields (neutral 100 never shown as coverage)', async () => {
        documents.findFirstById.mockResolvedValue({ ...baseDocument, graphListId: 'list-1', currentHealthScoreId: 'score-1' });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);
        healthScores.findMany.mockResolvedValue([{ id: 'score-1', compositeScore: 90, healthBand: 'Healthy', taxonomyScore: 100, calculatedAt: new Date() }]);
        sharePointClassificationFields.findManyActiveByLibrary.mockResolvedValue([]);

        const result = await service.getDocument('org-1', 'doc-1');

        expect(result?.taxonomyCoverage).toEqual({ state: 'notConfigured', score: null, configuredFieldCount: 0 });
      });

      it('is measured with the real coverage score when the library has active classification fields', async () => {
        documents.findFirstById.mockResolvedValue({ ...baseDocument, graphListId: 'list-1', currentHealthScoreId: 'score-1' });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);
        healthScores.findMany.mockResolvedValue([{ id: 'score-1', compositeScore: 70, healthBand: 'NeedsAttention', taxonomyScore: 50, calculatedAt: new Date() }]);
        sharePointClassificationFields.findManyActiveByLibrary.mockResolvedValue([{ id: 'f1' }, { id: 'f2' }]);

        const result = await service.getDocument('org-1', 'doc-1');

        expect(result?.taxonomyCoverage).toEqual({ state: 'measured', score: 50, configuredFieldCount: 2 });
      });

      it('is notConfigured with no library lookup when the document has no graphListId', async () => {
        documents.findFirstById.mockResolvedValue({ ...baseDocument, graphListId: null, currentHealthScoreId: 'score-1' });
        sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);
        healthScores.findMany.mockResolvedValue([{ id: 'score-1', compositeScore: 90, healthBand: 'Healthy', taxonomyScore: 100, calculatedAt: new Date() }]);

        const result = await service.getDocument('org-1', 'doc-1');

        expect(result?.taxonomyCoverage.state).toBe('notConfigured');
        expect(sharePointClassificationFields.findManyActiveByLibrary).not.toHaveBeenCalled();
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

    it('always creates a ManualAssignment / AssignedOwner row, stamped with the assigning user and now (ADR-0016 §4.2), and records OwnerAssigned activity', async () => {
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
      users.findMany.mockResolvedValue([{ id: 'user-sarah', email: 'sarah@example.com', status: 'Active' }]);

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
      expect(governanceActivityService.record).toHaveBeenCalledWith('org-1', {
        documentId: 'doc-1',
        actorUserId: 'admin-1',
        activityType: 'OwnerAssigned',
        newValue: 'Sarah',
        // ADR-0021 §3.2: resolved against a registered, Active User by
        // email — ownerEmail matched a real user here, so this is set.
        notifyUserId: 'user-sarah',
      });
    });

    it('does not resolve a notification recipient when the new owner email matches no registered Active user (ADR-0021)', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1' });
      documentOwners.create.mockResolvedValue({
        id: 'owner-new',
        ownerType: 'AssignedOwner',
        displayName: 'External Person',
        email: 'external@example.com',
        source: 'ManualAssignment',
        assignedByUserId: 'admin-1',
        assignedAt: new Date(),
      });
      users.findMany.mockResolvedValue([]); // no matching registered user

      await service.assignOwner('org-1', 'doc-1', 'admin-1', { displayName: 'External Person', email: 'external@example.com' });

      expect(governanceActivityService.record).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ notifyUserId: null }),
      );
    });

    it('does not record activity when the document does not exist', async () => {
      documents.findFirstById.mockResolvedValue(null);
      await service.assignOwner('org-1', 'doc-missing', 'admin-1', { displayName: 'Sarah' });
      expect(governanceActivityService.record).not.toHaveBeenCalled();
    });
  });

  describe('removeOwner', () => {
    it('throws NotFoundException when the owner does not exist for this document/organization', async () => {
      documentOwners.findMany.mockResolvedValue([]);
      await expect(service.removeOwner('org-1', 'doc-1', 'owner-missing', 'admin-1')).rejects.toThrow(
        'Document owner not found',
      );
      expect(governanceActivityService.record).not.toHaveBeenCalled();
    });

    it('throws ConflictException and never deletes a GraphMetadata-sourced owner (ADR-0016 §4.2 — worker-owned)', async () => {
      documentOwners.findMany.mockResolvedValue([{ id: 'owner-1', source: 'GraphMetadata' }]);

      await expect(service.removeOwner('org-1', 'doc-1', 'owner-1', 'admin-1')).rejects.toThrow(
        'Only a manually assigned owner can be removed',
      );
      expect(documentOwners.deleteById).not.toHaveBeenCalled();
      expect(governanceActivityService.record).not.toHaveBeenCalled();
    });

    it('deletes a ManualAssignment-sourced owner and records OwnerRemoved activity', async () => {
      documentOwners.findMany.mockResolvedValue([
        { id: 'owner-2', source: 'ManualAssignment', displayName: 'Sarah', email: 'sarah@example.com' },
      ]);

      await service.removeOwner('org-1', 'doc-1', 'owner-2', 'admin-1');

      expect(documentOwners.deleteById).toHaveBeenCalledWith('owner-2');
      expect(governanceActivityService.record).toHaveBeenCalledWith('org-1', {
        documentId: 'doc-1',
        actorUserId: 'admin-1',
        activityType: 'OwnerRemoved',
        previousValue: 'Sarah',
      });
    });
  });

  // ADR-0002 amendment / ADR-0016 §4.3, §7: the only write path for
  // Document.nextReviewDueAt, the real signal apps/worker's scoring pass
  // reads for the ReviewStatus criterion.
  describe('setReviewDate', () => {
    it('returns null when the document does not exist for this organization', async () => {
      documents.findFirstById.mockResolvedValue(null);
      const result = await service.setReviewDate('org-1', 'doc-from-another-org', '2026-12-01T00:00:00.000Z');
      expect(result).toBeNull();
      expect(documents.updateById).not.toHaveBeenCalled();
    });

    it('sets nextReviewDueAt and stamps reviewDateSource: Manual', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1' });
      documents.updateById.mockResolvedValue({
        id: 'doc-1',
        nextReviewDueAt: new Date('2026-12-01T00:00:00.000Z'),
        reviewDateSource: 'Manual',
      });

      const result = await service.setReviewDate('org-1', 'doc-1', '2026-12-01T00:00:00.000Z');

      expect(documents.updateById).toHaveBeenCalledWith('doc-1', {
        nextReviewDueAt: new Date('2026-12-01T00:00:00.000Z'),
        reviewDateSource: 'Manual',
      });
      expect(result).toEqual({
        documentId: 'doc-1',
        nextReviewDueAt: '2026-12-01T00:00:00.000Z',
        reviewDateSource: 'Manual',
      });
    });

    it('clears nextReviewDueAt when passed null', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1' });
      documents.updateById.mockResolvedValue({ id: 'doc-1', nextReviewDueAt: null, reviewDateSource: 'Manual' });

      const result = await service.setReviewDate('org-1', 'doc-1', null);

      expect(documents.updateById).toHaveBeenCalledWith('doc-1', { nextReviewDueAt: null, reviewDateSource: 'Manual' });
      expect(result).toEqual({ documentId: 'doc-1', nextReviewDueAt: null, reviewDateSource: 'Manual' });
    });

    describe('SharePoint-managed conflict guard (Phase 3A-1, ADR-0016 §17.4)', () => {
      it('rejects with a 409 identifying the mapped column when the library has an Active mapping — never silently overwrites', async () => {
        documents.findFirstById.mockResolvedValue({ id: 'doc-1', siteId: 'site-1', graphListId: 'list-1' });
        sharePointReviewDateMappings.findByLibrary.mockResolvedValue({
          status: 'Active',
          columnDisplayNameAtConfirmation: 'Review Date',
        });

        await expect(service.setReviewDate('org-1', 'doc-1', '2026-12-01T00:00:00.000Z')).rejects.toThrow(
          /managed by SharePoint.*Review Date/,
        );
        expect(documents.updateById).not.toHaveBeenCalled();
      });

      it('looks up the mapping using this document\'s own siteId/graphListId, not any other value (tenant/document isolation)', async () => {
        documents.findFirstById.mockResolvedValue({ id: 'doc-1', siteId: 'site-42', graphListId: 'list-99' });
        sharePointReviewDateMappings.findByLibrary.mockResolvedValue(null);
        documents.updateById.mockResolvedValue({ id: 'doc-1', nextReviewDueAt: null, reviewDateSource: 'Manual' });

        await service.setReviewDate('org-1', 'doc-1', null);

        expect(sharePointReviewDateMappings.findByLibrary).toHaveBeenCalledWith('site-42', 'list-99');
        // createTenantContext('org-1') already scopes sharePointReviewDateMappings
        // to this organization (verified by the repository's own tenant-isolation
        // tests) — this assertion confirms the service passes through the
        // document's real identifiers rather than anything client-supplied.
      });

      it('allows the manual write when the mapping is Stale — SharePoint cannot currently provide a value', async () => {
        documents.findFirstById.mockResolvedValue({ id: 'doc-1', siteId: 'site-1', graphListId: 'list-1' });
        sharePointReviewDateMappings.findByLibrary.mockResolvedValue({
          status: 'Stale',
          columnDisplayNameAtConfirmation: 'Review Date',
        });
        documents.updateById.mockResolvedValue({
          id: 'doc-1',
          nextReviewDueAt: new Date('2026-12-01T00:00:00.000Z'),
          reviewDateSource: 'Manual',
        });

        const result = await service.setReviewDate('org-1', 'doc-1', '2026-12-01T00:00:00.000Z');

        expect(result).not.toBeNull();
        expect(documents.updateById).toHaveBeenCalled();
      });

      it('allows the manual write when no mapping exists for the library at all', async () => {
        documents.findFirstById.mockResolvedValue({ id: 'doc-1', siteId: 'site-1', graphListId: 'list-1' });
        sharePointReviewDateMappings.findByLibrary.mockResolvedValue(null);
        documents.updateById.mockResolvedValue({
          id: 'doc-1',
          nextReviewDueAt: new Date('2026-12-01T00:00:00.000Z'),
          reviewDateSource: 'Manual',
        });

        const result = await service.setReviewDate('org-1', 'doc-1', '2026-12-01T00:00:00.000Z');

        expect(result).not.toBeNull();
        expect(documents.updateById).toHaveBeenCalled();
      });

      it('allows the manual write without any lookup when the document has no graphListId', async () => {
        documents.findFirstById.mockResolvedValue({ id: 'doc-1' });
        documents.updateById.mockResolvedValue({
          id: 'doc-1',
          nextReviewDueAt: new Date('2026-12-01T00:00:00.000Z'),
          reviewDateSource: 'Manual',
        });

        const result = await service.setReviewDate('org-1', 'doc-1', '2026-12-01T00:00:00.000Z');

        expect(result).not.toBeNull();
        expect(sharePointReviewDateMappings.findByLibrary).not.toHaveBeenCalled();
      });
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
        {
          id: 'doc-1',
          name: 'Employee Handbook.docx',
          siteId: 'site-1',
          status: 'Active',
          sourceModifiedAt: new Date('2026-06-01T00:00:00.000Z'),
          currentHealthScoreId: 'score-1',
          nextReviewDueAt: null,
        },
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
          nextReviewDueAt: null,
          reviewDateHealth: 'Missing',
        },
      ]);
      expect(result.pagination).toEqual({ page: 1, pageSize: 25, total: 1, totalPages: 1 });
    });

    // Phase 3A-1: same classifyReviewDateHealth call listDocumentHealth now
    // makes per row — pinned clock, matching the getDocument coverage above.
    describe('reviewDateHealth per row (Phase 3A-1)', () => {
      const NOW = new Date('2026-08-19T00:00:00.000Z');

      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(NOW);
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('classifies each row independently using a shared "now"', async () => {
        documents.findMany.mockResolvedValue([
          {
            id: 'doc-overdue',
            name: 'Overdue.docx',
            siteId: 'site-1',
            status: 'Active',
            sourceModifiedAt: new Date('2026-06-01T00:00:00.000Z'),
            currentHealthScoreId: 'score-1',
            nextReviewDueAt: new Date('2026-08-01T00:00:00.000Z'),
          },
          {
            id: 'doc-healthy',
            name: 'Healthy.docx',
            siteId: 'site-1',
            status: 'Active',
            sourceModifiedAt: new Date('2026-06-01T00:00:00.000Z'),
            currentHealthScoreId: 'score-2',
            nextReviewDueAt: new Date('2026-12-01T00:00:00.000Z'),
          },
        ]);
        documents.count.mockResolvedValue(2);
        healthScores.findMany.mockResolvedValue([
          { id: 'score-1', compositeScore: 50, healthBand: 'NeedsAttention', calculatedAt: new Date('2026-07-01T00:00:00.000Z') },
          { id: 'score-2', compositeScore: 100, healthBand: 'Healthy', calculatedAt: new Date('2026-07-01T00:00:00.000Z') },
        ]);

        const result = await service.listDocumentHealth('org-1', {});

        expect(result.data.find((d) => d.documentId === 'doc-overdue')?.reviewDateHealth).toBe('Overdue');
        expect(result.data.find((d) => d.documentId === 'doc-healthy')?.reviewDateHealth).toBe('Healthy');
      });
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
