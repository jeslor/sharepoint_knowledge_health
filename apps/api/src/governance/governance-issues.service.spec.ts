import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import { GovernanceActivityService } from './governance-activity.service';
import { GovernanceIssuesService } from './governance-issues.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('GovernanceIssuesService', () => {
  const governanceActivityService = { record: jest.fn() };
  const service = new GovernanceIssuesService(governanceActivityService as unknown as GovernanceActivityService);

  const governanceIssues = {
    findMany: jest.fn(),
    findFirstById: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    updateById: jest.fn(),
    groupByIssueType: jest.fn(),
  };
  const documents = { findFirstById: jest.fn(), findMany: jest.fn() };
  const healthIssues = { findMany: jest.fn() };
  const sharePointSites = { findMany: jest.fn() };
  const users = { findFirstById: jest.fn(), findMany: jest.fn() };
  const documentOwners = { findMany: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({
      governanceIssues,
      documents,
      healthIssues,
      sharePointSites,
      users,
      documentOwners,
    } as never);
    governanceIssues.findMany.mockResolvedValue([]);
    governanceIssues.count.mockResolvedValue(0);
    governanceIssues.groupByIssueType.mockResolvedValue([]);
    documents.findMany.mockResolvedValue([]);
    healthIssues.findMany.mockResolvedValue([]);
    sharePointSites.findMany.mockResolvedValue([]);
    users.findMany.mockResolvedValue([]);
    users.findFirstById.mockResolvedValue(null);
    documentOwners.findMany.mockResolvedValue([]);
  });

  describe('listIssues', () => {
    it('returns an empty page when the organization has no governance issues', async () => {
      const result = await service.listIssues('org-1', {});
      expect(result).toEqual({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });
    });

    it('applies status/severity/assignedUserId/issueType/documentId filters to the where clause', async () => {
      await service.listIssues('org-1', {
        status: 'Open',
        severity: 'RequiresReview',
        assignedUserId: 'user-1',
        issueType: 'Freshness',
        documentId: 'doc-1',
      });

      expect(governanceIssues.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'Open',
            severity: 'RequiresReview',
            assignedUserId: 'user-1',
            issueType: 'Freshness',
            documentId: 'doc-1',
          },
        }),
      );
    });

    describe('excludeResolved (Phase 1 work-queue default)', () => {
      it('adds status: { not: "Resolved" } to the where clause when excludeResolved is true and no explicit status is set', async () => {
        await service.listIssues('org-1', { assignedUserId: 'user-1', excludeResolved: true });

        expect(governanceIssues.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { assignedUserId: 'user-1', status: { not: 'Resolved' } },
          }),
        );
        expect(governanceIssues.count).toHaveBeenCalledWith({
          where: { assignedUserId: 'user-1', status: { not: 'Resolved' } },
        });
      });

      it('lets an explicit status win over excludeResolved — an explicit choice is never silently overridden', async () => {
        await service.listIssues('org-1', { status: 'Resolved', excludeResolved: true });

        expect(governanceIssues.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { status: 'Resolved' } }),
        );
      });

      it('has no effect on the where clause when excludeResolved is false or omitted', async () => {
        await service.listIssues('org-1', { assignedUserId: 'user-1', excludeResolved: false });

        expect(governanceIssues.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { assignedUserId: 'user-1' } }),
        );
      });
    });

    describe('severity sorting (Phase 1 work-queue)', () => {
      it('orders by severity descending (RequiresReview/urgent first) then createdAt ascending, at the database level', async () => {
        await service.listIssues('org-1', { sortBy: 'severity' });

        expect(governanceIssues.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }] }),
        );
      });

      it('ignores an incoming sortDir when sortBy is severity — urgent-first is a fixed invariant, not toggled', async () => {
        await service.listIssues('org-1', { sortBy: 'severity', sortDir: 'asc' });

        expect(governanceIssues.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }] }),
        );
      });

      it('preserves existing createdAt/updatedAt single-key sorting when sortBy is not severity', async () => {
        await service.listIssues('org-1', { sortBy: 'updatedAt', sortDir: 'asc' });

        expect(governanceIssues.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ orderBy: { updatedAt: 'asc' } }),
        );
      });

      it('defaults to createdAt descending when sortBy is omitted, unchanged from existing behavior', async () => {
        await service.listIssues('org-1', {});

        expect(governanceIssues.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
        );
      });

      it('preserves pagination (skip/take) alongside severity sorting', async () => {
        await service.listIssues('org-1', { sortBy: 'severity', page: 3, pageSize: 10 });

        expect(governanceIssues.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
      });
    });

    it('enriches each issue with documentName, siteName, assignedUserName, and the derived stillDetected flag', async () => {
      governanceIssues.findMany.mockResolvedValue([
        {
          id: 'issue-1',
          documentId: 'doc-1',
          issueType: 'Freshness',
          severity: 'RequiresReview',
          status: 'Open',
          assignedUserId: 'user-1',
          resolutionNotes: null,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          resolvedAt: null,
        },
      ]);
      documents.findMany.mockResolvedValue([{ id: 'doc-1', name: 'Handbook.docx', siteId: 'site-1', currentHealthScoreId: 'score-1' }]);
      sharePointSites.findMany.mockResolvedValue([{ id: 'site-1', displayName: 'Team Site' }]);
      users.findMany.mockResolvedValue([{ id: 'user-1', displayName: 'Sarah' }]);
      healthIssues.findMany.mockResolvedValue([{ healthScoreId: 'score-1', criterion: 'Freshness' }]);

      const result = await service.listIssues('org-1', {});

      expect(result.data).toEqual([
        expect.objectContaining({
          id: 'issue-1',
          documentName: 'Handbook.docx',
          siteName: 'Team Site',
          assignedUserName: 'Sarah',
          stillDetected: true,
        }),
      ]);
    });

    it('marks stillDetected false when the current scan no longer reports a matching HealthIssue', async () => {
      governanceIssues.findMany.mockResolvedValue([
        {
          id: 'issue-1',
          documentId: 'doc-1',
          issueType: 'Freshness',
          severity: 'RequiresReview',
          status: 'Open',
          assignedUserId: null,
          resolutionNotes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          resolvedAt: null,
        },
      ]);
      documents.findMany.mockResolvedValue([{ id: 'doc-1', name: 'Handbook.docx', siteId: 'site-1', currentHealthScoreId: 'score-2' }]);
      healthIssues.findMany.mockResolvedValue([{ healthScoreId: 'score-2', criterion: 'Ownership' }]); // different criterion — no match

      const result = await service.listIssues('org-1', {});
      expect(result.data[0]?.stillDetected).toBe(false);
    });

    it('keeps the snapshotted message visible even after the underlying HealthIssue disappears (stillDetected: false)', async () => {
      governanceIssues.findMany.mockResolvedValue([
        {
          id: 'issue-1',
          documentId: 'doc-1',
          issueType: 'Freshness',
          severity: 'RequiresReview',
          status: 'Open',
          assignedUserId: null,
          resolutionNotes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          resolvedAt: null,
          message: 'Document has not been modified in 480 days.',
        },
      ]);
      // Document has since been rescanned and no longer reports Freshness.
      documents.findMany.mockResolvedValue([{ id: 'doc-1', name: 'Handbook.docx', siteId: 'site-1', currentHealthScoreId: 'score-2' }]);
      healthIssues.findMany.mockResolvedValue([]);

      const result = await service.listIssues('org-1', {});

      expect(result.data[0]?.stillDetected).toBe(false);
      expect(result.data[0]?.message).toBe('Document has not been modified in 480 days.');
    });

    it('returns message: null for a pre-migration issue with no snapshotted message', async () => {
      governanceIssues.findMany.mockResolvedValue([
        {
          id: 'issue-1',
          documentId: 'doc-1',
          issueType: 'Freshness',
          severity: 'RequiresReview',
          status: 'Open',
          assignedUserId: null,
          resolutionNotes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          resolvedAt: null,
          message: null,
        },
      ]);
      documents.findMany.mockResolvedValue([{ id: 'doc-1', name: 'Handbook.docx', siteId: 'site-1', currentHealthScoreId: 'score-1' }]);

      const result = await service.listIssues('org-1', {});

      expect(result.data[0]?.message).toBeNull();
    });

    it('derives documentWebUrl live from the current Document.webUrl', async () => {
      governanceIssues.findMany.mockResolvedValue([
        {
          id: 'issue-1',
          documentId: 'doc-1',
          issueType: 'Freshness',
          severity: 'RequiresReview',
          status: 'Open',
          assignedUserId: null,
          resolutionNotes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          resolvedAt: null,
          message: null,
        },
      ]);
      documents.findMany.mockResolvedValue([
        { id: 'doc-1', name: 'Handbook.docx', siteId: 'site-1', currentHealthScoreId: 'score-1', webUrl: 'https://contoso.sharepoint.com/sites/finance/Handbook.docx' },
      ]);

      const result = await service.listIssues('org-1', {});

      expect(result.data[0]?.documentWebUrl).toBe('https://contoso.sharepoint.com/sites/finance/Handbook.docx');
    });

    it('returns documentWebUrl: null when the document has not been rescanned since this field was added', async () => {
      governanceIssues.findMany.mockResolvedValue([
        {
          id: 'issue-1',
          documentId: 'doc-1',
          issueType: 'Freshness',
          severity: 'RequiresReview',
          status: 'Open',
          assignedUserId: null,
          resolutionNotes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          resolvedAt: null,
          message: null,
        },
      ]);
      documents.findMany.mockResolvedValue([{ id: 'doc-1', name: 'Handbook.docx', siteId: 'site-1', currentHealthScoreId: 'score-1', webUrl: null }]);

      const result = await service.listIssues('org-1', {});

      expect(result.data[0]?.documentWebUrl).toBeNull();
    });
  });

  describe('getIssueTypeCounts', () => {
    it('returns counts grouped by issueType via a single SQL-level GROUP BY, not by fetching issues into memory', async () => {
      governanceIssues.groupByIssueType.mockResolvedValue([
        { issueType: 'Freshness', count: 12 },
        { issueType: 'ReviewStatus', count: 8 },
      ]);

      const result = await service.getIssueTypeCounts('org-1', {});

      expect(result).toEqual({ byType: { Freshness: 12, ReviewStatus: 8 } });
      // The anti-pattern this must avoid: no unbounded findMany() fetch.
      expect(governanceIssues.findMany).not.toHaveBeenCalled();
    });

    it('scopes the aggregation to the exact same effective filters as listIssues (assignedUserId + excludeResolved)', async () => {
      await service.getIssueTypeCounts('org-1', { assignedUserId: 'user-1', excludeResolved: true });

      expect(governanceIssues.groupByIssueType).toHaveBeenCalledWith({
        assignedUserId: 'user-1',
        status: { not: 'Resolved' },
      });
    });

    it('respects an explicit issueType filter, naturally yielding a single-entry result', async () => {
      governanceIssues.groupByIssueType.mockResolvedValue([{ issueType: 'Freshness', count: 5 }]);

      await service.getIssueTypeCounts('org-1', { issueType: 'Freshness' });

      expect(governanceIssues.groupByIssueType).toHaveBeenCalledWith({ issueType: 'Freshness' });
    });

    it('returns an empty byType record when nothing matches, rather than throwing', async () => {
      governanceIssues.groupByIssueType.mockResolvedValue([]);

      const result = await service.getIssueTypeCounts('org-1', { assignedUserId: 'user-nobody' });

      expect(result).toEqual({ byType: {} });
    });
  });

  describe('getIssue', () => {
    it('returns null when the issue does not exist for this organization (org isolation)', async () => {
      governanceIssues.findFirstById.mockResolvedValue(null);
      const result = await service.getIssue('org-1', 'issue-missing');
      expect(result).toBeNull();
    });
  });

  describe('createIssue', () => {
    it('throws ConflictException when a governance issue already exists for this document+issueType', async () => {
      governanceIssues.findMany.mockResolvedValue([{ id: 'existing' }]);

      await expect(
        service.createIssue('org-1', 'actor-1', { documentId: 'doc-1', issueType: 'Freshness' }),
      ).rejects.toThrow(ConflictException);
      expect(governanceIssues.create).not.toHaveBeenCalled();
      expect(governanceActivityService.record).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the document does not exist', async () => {
      documents.findFirstById.mockResolvedValue(null);

      await expect(
        service.createIssue('org-1', 'actor-1', { documentId: 'doc-missing', issueType: 'Freshness' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the document has never been scored', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1', currentHealthScoreId: null });

      await expect(
        service.createIssue('org-1', 'actor-1', { documentId: 'doc-1', issueType: 'Freshness' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when no currently-detected HealthIssue matches the requested issueType', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1', currentHealthScoreId: 'score-1' });
      healthIssues.findMany.mockResolvedValue([]);

      await expect(
        service.createIssue('org-1', 'actor-1', { documentId: 'doc-1', issueType: 'Freshness' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a GovernanceIssue with severity snapshotted from the matching HealthIssue, and records IssueCreated activity', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1', name: 'Handbook.docx', siteId: 'site-1', currentHealthScoreId: 'score-1' });
      healthIssues.findMany.mockImplementation(async ({ where }: { where: { criterion?: string } }) =>
        where.criterion === 'Freshness'
          ? [{ healthScoreId: 'score-1', criterion: 'Freshness', severity: 'RequiresReview', message: 'Document has not been modified in 480 days.' }]
          : [],
      );
      governanceIssues.create.mockResolvedValue({
        id: 'issue-1',
        documentId: 'doc-1',
        issueType: 'Freshness',
        severity: 'RequiresReview',
        status: 'Open',
        assignedUserId: null,
        resolutionNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        resolvedAt: null,
        message: 'Document has not been modified in 480 days.',
      });
      documents.findMany.mockResolvedValue([{ id: 'doc-1', name: 'Handbook.docx', siteId: 'site-1', currentHealthScoreId: 'score-1' }]);

      const result = await service.createIssue('org-1', 'actor-1', { documentId: 'doc-1', issueType: 'Freshness' });

      expect(governanceIssues.create).toHaveBeenCalledWith({
        documentId: 'doc-1',
        issueType: 'Freshness',
        severity: 'RequiresReview',
        assignedUserId: null,
        message: 'Document has not been modified in 480 days.',
      });
      expect(result.severity).toBe('RequiresReview');
      // Message is snapshotted from the matching HealthIssue at creation —
      // this is the diagnostic text the assignee sees, not just the raw
      // issueType enum.
      expect(result.message).toBe('Document has not been modified in 480 days.');
      expect(governanceActivityService.record).toHaveBeenCalledWith('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'IssueCreated',
        metadata: { issueType: 'Freshness', severity: 'RequiresReview' },
      });
      // No owner exists for this document, so no second (IssueAssigned) activity.
      expect(governanceActivityService.record).toHaveBeenCalledTimes(1);
    });

    it('defaults assignedUserId to the document\'s resolvable owner and records a separate IssueAssigned activity', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1', name: 'Handbook.docx', siteId: 'site-1', currentHealthScoreId: 'score-1' });
      healthIssues.findMany.mockImplementation(async ({ where }: { where: { criterion?: string } }) =>
        where.criterion === 'Freshness'
          ? [{ healthScoreId: 'score-1', criterion: 'Freshness', severity: 'RequiresReview', message: 'Document has not been modified in 480 days.' }]
          : [],
      );
      documentOwners.findMany.mockResolvedValue([
        { id: 'owner-1', ownerType: 'Author', source: 'GraphMetadata', email: 'alice@example.com', assignedAt: null },
      ]);
      users.findMany.mockResolvedValue([{ id: 'user-1', email: 'alice@example.com', status: 'Active' }]);
      users.findFirstById.mockResolvedValue({ id: 'user-1', displayName: 'Alice' });
      governanceIssues.create.mockResolvedValue({
        id: 'issue-1',
        documentId: 'doc-1',
        issueType: 'Freshness',
        severity: 'RequiresReview',
        status: 'Open',
        assignedUserId: 'user-1',
        resolutionNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        resolvedAt: null,
        message: 'Document has not been modified in 480 days.',
      });

      await service.createIssue('org-1', 'actor-1', { documentId: 'doc-1', issueType: 'Freshness' });

      expect(governanceIssues.create).toHaveBeenCalledWith({
        documentId: 'doc-1',
        issueType: 'Freshness',
        severity: 'RequiresReview',
        assignedUserId: 'user-1',
        message: 'Document has not been modified in 480 days.',
      });
      expect(governanceActivityService.record).toHaveBeenCalledWith('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'IssueAssigned',
        previousValue: null,
        newValue: 'Alice',
        notifyUserId: 'user-1',
        notifyIssueType: 'Freshness',
        notifyIssueSeverity: 'RequiresReview',
      });
    });

    it('prefers a ManualAssignment owner over the Graph-detected Author when both exist', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1', name: 'Handbook.docx', siteId: 'site-1', currentHealthScoreId: 'score-1' });
      healthIssues.findMany.mockImplementation(async ({ where }: { where: { criterion?: string } }) =>
        where.criterion === 'Freshness' ? [{ healthScoreId: 'score-1', criterion: 'Freshness', severity: 'RequiresReview' }] : [],
      );
      documentOwners.findMany.mockResolvedValue([
        { id: 'owner-author', ownerType: 'Author', source: 'GraphMetadata', email: 'alice@example.com', assignedAt: null },
        { id: 'owner-manual', ownerType: 'AssignedOwner', source: 'ManualAssignment', email: 'bob@example.com', assignedAt: new Date('2026-07-01') },
      ]);
      users.findMany.mockImplementation(async ({ where }: { where: { email: string } }) =>
        where.email === 'bob@example.com' ? [{ id: 'user-bob', email: 'bob@example.com', status: 'Active' }] : [],
      );
      users.findFirstById.mockResolvedValue({ id: 'user-bob', displayName: 'Bob' });
      governanceIssues.create.mockResolvedValue({
        id: 'issue-1',
        documentId: 'doc-1',
        issueType: 'Freshness',
        severity: 'RequiresReview',
        status: 'Open',
        assignedUserId: 'user-bob',
        resolutionNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        resolvedAt: null,
      });

      await service.createIssue('org-1', 'actor-1', { documentId: 'doc-1', issueType: 'Freshness' });

      expect(governanceIssues.create).toHaveBeenCalledWith(
        expect.objectContaining({ assignedUserId: 'user-bob' }),
      );
    });

    it('leaves assignedUserId null when the document owner does not resolve to a registered, Active user', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1', name: 'Handbook.docx', siteId: 'site-1', currentHealthScoreId: 'score-1' });
      healthIssues.findMany.mockImplementation(async ({ where }: { where: { criterion?: string } }) =>
        where.criterion === 'Freshness' ? [{ healthScoreId: 'score-1', criterion: 'Freshness', severity: 'RequiresReview' }] : [],
      );
      documentOwners.findMany.mockResolvedValue([
        { id: 'owner-1', ownerType: 'Author', source: 'GraphMetadata', email: 'external@vendor.com', assignedAt: null },
      ]);
      users.findMany.mockResolvedValue([]); // no registered user matches this email
      governanceIssues.create.mockResolvedValue({
        id: 'issue-1',
        documentId: 'doc-1',
        issueType: 'Freshness',
        severity: 'RequiresReview',
        status: 'Open',
        assignedUserId: null,
        resolutionNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        resolvedAt: null,
      });

      await service.createIssue('org-1', 'actor-1', { documentId: 'doc-1', issueType: 'Freshness' });

      expect(governanceIssues.create).toHaveBeenCalledWith(
        expect.objectContaining({ assignedUserId: null }),
      );
      expect(governanceActivityService.record).toHaveBeenCalledTimes(1); // no second IssueAssigned activity
    });
  });

  describe('updateIssue', () => {
    const baseIssue = {
      id: 'issue-1',
      documentId: 'doc-1',
      issueType: 'Freshness',
      severity: 'RequiresReview',
      status: 'Open',
      assignedUserId: null,
      resolutionNotes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: null,
    };

    it('returns null when the issue does not exist for this organization', async () => {
      governanceIssues.findFirstById.mockResolvedValue(null);
      const result = await service.updateIssue('org-1', 'issue-missing', 'actor-1', 'Admin', { status: 'InProgress' });
      expect(result).toBeNull();
      expect(governanceActivityService.record).not.toHaveBeenCalled();
    });

    it.each([
      ['Open', 'Resolved'],
      ['InProgress', 'Open'],
      ['Resolved', 'InProgress'],
    ])('rejects an invalid transition from %s to %s', async (from, to) => {
      governanceIssues.findFirstById.mockResolvedValue({ ...baseIssue, status: from });

      await expect(
        service.updateIssue('org-1', 'issue-1', 'actor-1', 'Admin', { status: to as 'Open' | 'InProgress' | 'Resolved' }),
      ).rejects.toThrow(ConflictException);
      expect(governanceIssues.updateById).not.toHaveBeenCalled();
      expect(governanceActivityService.record).not.toHaveBeenCalled();
    });

    it.each([
      ['Open', 'InProgress', 'StatusChanged'],
      ['InProgress', 'Resolved', 'IssueResolved'],
      ['Resolved', 'Open', 'IssueReopened'],
    ])('allows the valid transition from %s to %s and records %s activity', async (from, to, activityType) => {
      governanceIssues.findFirstById.mockResolvedValue({ ...baseIssue, status: from });
      governanceIssues.updateById.mockResolvedValue({ ...baseIssue, status: to });
      documents.findMany.mockResolvedValue([]);

      await service.updateIssue('org-1', 'issue-1', 'actor-1', 'Admin', { status: to as 'Open' | 'InProgress' | 'Resolved' });

      expect(governanceIssues.updateById).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({ status: to, resolvedAt: to === 'Resolved' ? expect.any(Date) : null }),
      );
      expect(governanceActivityService.record).toHaveBeenCalledWith('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType,
        previousValue: from,
        newValue: to,
        // Only the Resolved -> Open edge (IssueReopened) notifies — see
        // GovernanceActivityService's NOTIFIABLE_ACTIVITY_TYPES map.
        // baseIssue.assignedUserId is null, so this stays null even for
        // IssueReopened here; a dedicated test below covers the assigned case.
        notifyUserId: null,
        notifyIssueType: 'Freshness',
        notifyIssueSeverity: 'RequiresReview',
      });
    });

    it('notifies the current assignee on IssueReopened (Resolved -> Open) when the issue is assigned', async () => {
      governanceIssues.findFirstById.mockResolvedValue({ ...baseIssue, status: 'Resolved', assignedUserId: 'user-1' });
      governanceIssues.updateById.mockResolvedValue({ ...baseIssue, status: 'Open', assignedUserId: 'user-1' });
      documents.findMany.mockResolvedValue([]);

      await service.updateIssue('org-1', 'issue-1', 'actor-1', 'Admin', { status: 'Open' });

      expect(governanceActivityService.record).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ activityType: 'IssueReopened', notifyUserId: 'user-1' }),
      );
    });

    it('is a no-op for a same-status update (not treated as an invalid transition, and records no activity)', async () => {
      governanceIssues.findFirstById.mockResolvedValue({ ...baseIssue, status: 'Open' });
      governanceIssues.updateById.mockResolvedValue(baseIssue);

      await service.updateIssue('org-1', 'issue-1', 'actor-1', 'Admin', { status: 'Open' });

      expect(governanceIssues.updateById).toHaveBeenCalledWith('issue-1', {});
      expect(governanceActivityService.record).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when assignedUserId does not resolve to a user in this organization', async () => {
      governanceIssues.findFirstById.mockResolvedValue(baseIssue);
      users.findFirstById.mockResolvedValue(null);

      await expect(
        service.updateIssue('org-1', 'issue-1', 'actor-1', 'Admin', { assignedUserId: 'user-other-org' }),
      ).rejects.toThrow(BadRequestException);
      expect(governanceIssues.updateById).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when assigning to an inactive user', async () => {
      governanceIssues.findFirstById.mockResolvedValue(baseIssue);
      users.findFirstById.mockResolvedValue({ id: 'user-1', status: 'Deactivated' });

      await expect(
        service.updateIssue('org-1', 'issue-1', 'actor-1', 'Admin', { assignedUserId: 'user-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('assigns to a valid, active, organization-scoped user and records IssueAssigned when there was no previous assignee', async () => {
      governanceIssues.findFirstById.mockResolvedValue(baseIssue);
      users.findFirstById.mockResolvedValue({ id: 'user-1', status: 'Active', displayName: 'Sarah' });
      governanceIssues.updateById.mockResolvedValue({ ...baseIssue, assignedUserId: 'user-1' });
      documents.findMany.mockResolvedValue([]);

      await service.updateIssue('org-1', 'issue-1', 'actor-1', 'Admin', { assignedUserId: 'user-1' });

      expect(governanceIssues.updateById).toHaveBeenCalledWith('issue-1', { assignedUserId: 'user-1' });
      expect(governanceActivityService.record).toHaveBeenCalledWith('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'IssueAssigned',
        previousValue: null,
        newValue: 'Sarah',
        // The new assignee is the notification recipient (ADR-0021 §3.2).
        notifyUserId: 'user-1',
        notifyIssueType: 'Freshness',
        notifyIssueSeverity: 'RequiresReview',
      });
    });

    it('records AssigneeChanged (not IssueAssigned) when reassigning from one user to another', async () => {
      governanceIssues.findFirstById.mockResolvedValue({ ...baseIssue, assignedUserId: 'user-1' });
      users.findFirstById.mockImplementation(async (id: string) =>
        id === 'user-1' ? { id: 'user-1', displayName: 'Sarah' } : { id: 'user-2', status: 'Active', displayName: 'John' },
      );
      governanceIssues.updateById.mockResolvedValue({ ...baseIssue, assignedUserId: 'user-2' });
      documents.findMany.mockResolvedValue([]);

      await service.updateIssue('org-1', 'issue-1', 'actor-1', 'Admin', { assignedUserId: 'user-2' });

      expect(governanceActivityService.record).toHaveBeenCalledWith('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'AssigneeChanged',
        previousValue: 'Sarah',
        newValue: 'John',
        notifyUserId: 'user-2',
        notifyIssueType: 'Freshness',
        notifyIssueSeverity: 'RequiresReview',
      });
    });

    it('allows unassigning by passing assignedUserId: null and records AssigneeChanged with a null newValue', async () => {
      governanceIssues.findFirstById.mockResolvedValue({ ...baseIssue, assignedUserId: 'user-1' });
      users.findFirstById.mockResolvedValue({ id: 'user-1', displayName: 'Sarah' });
      governanceIssues.updateById.mockResolvedValue({ ...baseIssue, assignedUserId: null });
      documents.findMany.mockResolvedValue([]);

      await service.updateIssue('org-1', 'issue-1', 'actor-1', 'Admin', { assignedUserId: null });

      expect(governanceIssues.updateById).toHaveBeenCalledWith('issue-1', { assignedUserId: null });
      expect(governanceActivityService.record).toHaveBeenCalledWith('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'AssigneeChanged',
        previousValue: 'Sarah',
        newValue: null,
        // Unassignment — inert in record() since notifyUserId is null (no
        // Notification created), covered directly in
        // governance-activity.service.spec.ts.
        notifyUserId: null,
        notifyIssueType: 'Freshness',
        notifyIssueSeverity: 'RequiresReview',
      });
    });

    it('updates resolutionNotes independently of status and records ResolutionNoteUpdated', async () => {
      governanceIssues.findFirstById.mockResolvedValue(baseIssue);
      governanceIssues.updateById.mockResolvedValue({ ...baseIssue, resolutionNotes: 'Fixed via reassignment' });
      documents.findMany.mockResolvedValue([]);

      await service.updateIssue('org-1', 'issue-1', 'actor-1', 'Admin', { resolutionNotes: 'Fixed via reassignment' });

      expect(governanceIssues.updateById).toHaveBeenCalledWith('issue-1', { resolutionNotes: 'Fixed via reassignment' });
      expect(governanceActivityService.record).toHaveBeenCalledWith('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'ResolutionNoteUpdated',
        previousValue: null,
        newValue: 'Fixed via reassignment',
      });
    });

    it('records multiple activity rows when status and assignment both change in one PATCH', async () => {
      governanceIssues.findFirstById.mockResolvedValue(baseIssue);
      users.findFirstById.mockResolvedValue({ id: 'user-1', status: 'Active', displayName: 'Sarah' });
      governanceIssues.updateById.mockResolvedValue({ ...baseIssue, status: 'InProgress', assignedUserId: 'user-1' });
      documents.findMany.mockResolvedValue([]);

      await service.updateIssue('org-1', 'issue-1', 'actor-1', 'Admin', { status: 'InProgress', assignedUserId: 'user-1' });

      expect(governanceActivityService.record).toHaveBeenCalledTimes(2);
      expect(governanceActivityService.record).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ activityType: 'StatusChanged' }),
      );
      expect(governanceActivityService.record).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ activityType: 'IssueAssigned' }),
      );
    });

    describe('assignee self-service (ADR-0021 §3.6 / ADR-0016 §16.2)', () => {
      const assignedToSelf = { ...baseIssue, status: 'Open', assignedUserId: 'member-1' };

      it('lets the assignee move their own issue Open -> InProgress', async () => {
        governanceIssues.findFirstById.mockResolvedValue(assignedToSelf);
        governanceIssues.updateById.mockResolvedValue({ ...assignedToSelf, status: 'InProgress' });
        documents.findMany.mockResolvedValue([]);

        await service.updateIssue('org-1', 'issue-1', 'member-1', 'Member', { status: 'InProgress' });

        expect(governanceIssues.updateById).toHaveBeenCalledWith(
          'issue-1',
          expect.objectContaining({ status: 'InProgress' }),
        );
      });

      it('lets the assignee move their own issue InProgress -> Resolved', async () => {
        governanceIssues.findFirstById.mockResolvedValue({ ...assignedToSelf, status: 'InProgress' });
        governanceIssues.updateById.mockResolvedValue({ ...assignedToSelf, status: 'Resolved' });
        documents.findMany.mockResolvedValue([]);

        await service.updateIssue('org-1', 'issue-1', 'member-1', 'Member', { status: 'Resolved' });

        expect(governanceIssues.updateById).toHaveBeenCalledWith(
          'issue-1',
          expect.objectContaining({ status: 'Resolved' }),
        );
      });

      it('lets the assignee update resolutionNotes on their own issue', async () => {
        governanceIssues.findFirstById.mockResolvedValue(assignedToSelf);
        governanceIssues.updateById.mockResolvedValue({ ...assignedToSelf, resolutionNotes: 'Cleaned up in SharePoint' });
        documents.findMany.mockResolvedValue([]);

        await service.updateIssue('org-1', 'issue-1', 'member-1', 'Member', { resolutionNotes: 'Cleaned up in SharePoint' });

        expect(governanceIssues.updateById).toHaveBeenCalledWith('issue-1', { resolutionNotes: 'Cleaned up in SharePoint' });
      });

      it('rejects an assignee reopening their own Resolved issue (Resolved -> Open stays Admin/GovernanceManager-only)', async () => {
        governanceIssues.findFirstById.mockResolvedValue({ ...assignedToSelf, status: 'Resolved' });

        await expect(
          service.updateIssue('org-1', 'issue-1', 'member-1', 'Member', { status: 'Open' }),
        ).rejects.toThrow(ForbiddenException);
        expect(governanceIssues.updateById).not.toHaveBeenCalled();
      });

      it('rejects an assignee reassigning their own issue, even to themselves', async () => {
        governanceIssues.findFirstById.mockResolvedValue(assignedToSelf);

        await expect(
          service.updateIssue('org-1', 'issue-1', 'member-1', 'Member', { assignedUserId: 'member-1' }),
        ).rejects.toThrow(ForbiddenException);
        expect(governanceIssues.updateById).not.toHaveBeenCalled();
      });

      it('rejects a Member who is not this issue\'s assignee', async () => {
        governanceIssues.findFirstById.mockResolvedValue({ ...baseIssue, assignedUserId: 'someone-else' });

        await expect(
          service.updateIssue('org-1', 'issue-1', 'member-1', 'Member', { status: 'InProgress' }),
        ).rejects.toThrow(ForbiddenException);
        expect(governanceIssues.updateById).not.toHaveBeenCalled();
      });

      it('rejects a Member on an unassigned issue (no assignedUserId to match against)', async () => {
        governanceIssues.findFirstById.mockResolvedValue({ ...baseIssue, assignedUserId: null });

        await expect(
          service.updateIssue('org-1', 'issue-1', 'member-1', 'Member', { status: 'InProgress' }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('rejects a Member who WAS the assignee but has since been reassigned away — the check is live, not cached', async () => {
        governanceIssues.findFirstById.mockResolvedValue({ ...baseIssue, assignedUserId: 'someone-new' });

        await expect(
          service.updateIssue('org-1', 'issue-1', 'member-1', 'Member', { resolutionNotes: 'still trying to update' }),
        ).rejects.toThrow(ForbiddenException);
      });

      // Explicit security regression test: a mixed payload combining a
      // privileged field (assignedUserId) with otherwise-individually-valid
      // fields (an allowed forward status transition, resolutionNotes) must
      // be rejected in its entirety — nothing partially applied, and the
      // privileged field must not "smuggle through" alongside legitimate
      // ones. assertUpdateAuthorized runs entirely before any write, so
      // this proves atomicity, not just that the field itself is checked.
      it('rejects a mixed payload combining an allowed status change with a forbidden reassignment — the whole request is denied, nothing partially applied', async () => {
        governanceIssues.findFirstById.mockResolvedValue(assignedToSelf);

        await expect(
          service.updateIssue('org-1', 'issue-1', 'member-1', 'Member', {
            status: 'InProgress', // would be allowed alone
            assignedUserId: 'someone-else', // privileged — must poison the whole request
            resolutionNotes: 'attempting privilege escalation', // would be allowed alone
          }),
        ).rejects.toThrow(ForbiddenException);
        expect(governanceIssues.updateById).not.toHaveBeenCalled();
        expect(governanceActivityService.record).not.toHaveBeenCalled();
      });

      it('GovernanceManager retains full rights unchanged, including reopen and reassignment (not narrowed by the self-service exception)', async () => {
        governanceIssues.findFirstById.mockResolvedValue({ ...baseIssue, status: 'Resolved', assignedUserId: 'member-1' });
        users.findFirstById.mockResolvedValue({ id: 'user-2', status: 'Active', displayName: 'Priya' });
        governanceIssues.updateById.mockResolvedValue({ ...baseIssue, status: 'Open', assignedUserId: 'user-2' });
        documents.findMany.mockResolvedValue([]);

        await service.updateIssue('org-1', 'issue-1', 'manager-1', 'GovernanceManager', {
          status: 'Open',
          assignedUserId: 'user-2',
        });

        expect(governanceIssues.updateById).toHaveBeenCalledWith(
          'issue-1',
          expect.objectContaining({ status: 'Open', assignedUserId: 'user-2' }),
        );
      });
    });
  });

  describe('getSummary (scale-hardening: bounded COUNT/GROUP BY queries, not findMany + in-memory filtering)', () => {
    const fixedNow = new Date('2026-07-15T12:00:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(fixedNow);
      // Sane defaults so each test only overrides what it cares about —
      // every getSummary() call now issues 9 parallel, independent queries.
      governanceIssues.count.mockResolvedValue(0);
      governanceIssues.groupByIssueType.mockResolvedValue([]);
      governanceIssues.findMany.mockResolvedValue([]);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('never fetches the full issue set — only bounded counts and a GROUP BY', async () => {
      await service.getSummary('org-1');

      // The historical anti-pattern this hardening removes: an
      // unconditional findMany() with no where clause at all.
      expect(governanceIssues.findMany).not.toHaveBeenCalledWith(undefined);
      expect(governanceIssues.findMany).not.toHaveBeenCalledWith({});
      // The one legitimate findMany is scoped to Resolved+dated issues only.
      expect(governanceIssues.findMany).toHaveBeenCalledWith({
        where: { status: 'Resolved', resolvedAt: { not: null } },
      });
      expect(governanceIssues.groupByIssueType).toHaveBeenCalledWith({ status: { not: 'Resolved' } });
    });

    it('counts open/inProgress/resolved via independently-scoped COUNT queries, organization isolation preserved by the repository layer', async () => {
      governanceIssues.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.status === 'Open') return 2;
        if (where.status === 'InProgress') return 1;
        if (where.status === 'Resolved' && !('resolvedAt' in where)) return 1;
        return 0;
      });

      const result = await service.getSummary('org-1');

      expect(governanceIssues.count).toHaveBeenCalledWith({ where: { status: 'Open' } });
      expect(governanceIssues.count).toHaveBeenCalledWith({ where: { status: 'InProgress' } });
      expect(governanceIssues.count).toHaveBeenCalledWith({ where: { status: 'Resolved' } });
      // totalCount is derived from the three closed-enum status counts, not a fourth query.
      expect(result.openCount).toBe(2);
      expect(result.inProgressCount).toBe(1);
      expect(result.resolvedCount).toBe(1);
      expect(result.totalCount).toBe(4);
      expect(result.completionRate).toBe(25);
    });

    it('counts criticalCount as non-Resolved + RequiresReview severity, excluding Resolved issues', async () => {
      await service.getSummary('org-1');

      expect(governanceIssues.count).toHaveBeenCalledWith({
        where: { status: { not: 'Resolved' }, severity: 'RequiresReview' },
      });
    });

    it('counts assignedCount as non-Resolved + assigned, excluding Resolved issues', async () => {
      await service.getSummary('org-1');

      expect(governanceIssues.count).toHaveBeenCalledWith({
        where: { status: { not: 'Resolved' }, assignedUserId: { not: null } },
      });
    });

    it('derives byType from groupByIssueType, scoped to non-Resolved issues, matching the existing getIssueTypeCounts() shape exactly', async () => {
      governanceIssues.groupByIssueType.mockResolvedValue([
        { issueType: 'Freshness', count: 2 },
        { issueType: 'Ownership', count: 1 },
      ]);

      const result = await service.getSummary('org-1');

      expect(result.byType).toEqual({ Freshness: 2, Ownership: 1 });
    });

    it('returns totalCount 0 and completionRate 0 when the organization has no governance issues', async () => {
      const result = await service.getSummary('org-1');
      expect(result.totalCount).toBe(0);
      expect(result.completionRate).toBe(0);
      expect(result.averageResolutionTimeHours).toBeNull();
    });

    it('computes averageResolutionTimeHours from the Resolved+dated subset returned by the narrow findMany', async () => {
      governanceIssues.findMany.mockResolvedValue([
        { status: 'Resolved', createdAt: new Date('2026-06-01T00:00:00.000Z'), resolvedAt: new Date('2026-06-02T00:00:00.000Z') }, // 24h
        { status: 'Resolved', createdAt: new Date('2026-06-01T00:00:00.000Z'), resolvedAt: new Date('2026-06-04T00:00:00.000Z') }, // 72h
      ]);

      const result = await service.getSummary('org-1');

      expect(result.averageResolutionTimeHours).toBe(48);
    });

    it('counts createdThisMonth and resolvedThisMonth against the current UTC calendar month via scoped COUNT queries', async () => {
      governanceIssues.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if ('createdAt' in where && !('status' in where)) return 1; // createdThisMonth
        if (where.status === 'Resolved' && 'resolvedAt' in where) return 1; // resolvedThisMonth
        return 0;
      });

      const result = await service.getSummary('org-1');

      const startOfMonth = new Date(Date.UTC(2026, 6, 1));
      expect(governanceIssues.count).toHaveBeenCalledWith({ where: { createdAt: { gte: startOfMonth } } });
      expect(governanceIssues.count).toHaveBeenCalledWith({
        where: { status: 'Resolved', resolvedAt: { gte: startOfMonth } },
      });
      expect(result.createdThisMonth).toBe(1);
      expect(result.resolvedThisMonth).toBe(1);
    });
  });

  describe('tenant isolation', () => {
    it('only reads this organization\'s tenant context (org isolation via createTenantContext)', async () => {
      await service.listIssues('org-42', {});
      expect(mockedCreateContext).toHaveBeenCalledWith('org-42');
    });
  });
});
