import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import { GovernanceActivityService } from './governance-activity.service';
import { GovernanceIssuesService } from './governance-issues.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('GovernanceIssuesService', () => {
  const governanceActivityService = { record: jest.fn() };
  const service = new GovernanceIssuesService(governanceActivityService as unknown as GovernanceActivityService);

  const governanceIssues = { findMany: jest.fn(), findFirstById: jest.fn(), count: jest.fn(), create: jest.fn(), updateById: jest.fn() };
  const documents = { findFirstById: jest.fn(), findMany: jest.fn() };
  const healthIssues = { findMany: jest.fn() };
  const sharePointSites = { findMany: jest.fn() };
  const users = { findFirstById: jest.fn(), findMany: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ governanceIssues, documents, healthIssues, sharePointSites, users } as never);
    governanceIssues.findMany.mockResolvedValue([]);
    governanceIssues.count.mockResolvedValue(0);
    documents.findMany.mockResolvedValue([]);
    healthIssues.findMany.mockResolvedValue([]);
    sharePointSites.findMany.mockResolvedValue([]);
    users.findMany.mockResolvedValue([]);
    users.findFirstById.mockResolvedValue(null);
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
        where.criterion === 'Freshness' ? [{ healthScoreId: 'score-1', criterion: 'Freshness', severity: 'RequiresReview' }] : [],
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
      });
      documents.findMany.mockResolvedValue([{ id: 'doc-1', name: 'Handbook.docx', siteId: 'site-1', currentHealthScoreId: 'score-1' }]);

      const result = await service.createIssue('org-1', 'actor-1', { documentId: 'doc-1', issueType: 'Freshness' });

      expect(governanceIssues.create).toHaveBeenCalledWith({
        documentId: 'doc-1',
        issueType: 'Freshness',
        severity: 'RequiresReview',
      });
      expect(result.severity).toBe('RequiresReview');
      expect(governanceActivityService.record).toHaveBeenCalledWith('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'IssueCreated',
        metadata: { issueType: 'Freshness', severity: 'RequiresReview' },
      });
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
      const result = await service.updateIssue('org-1', 'issue-missing', 'actor-1', { status: 'InProgress' });
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
        service.updateIssue('org-1', 'issue-1', 'actor-1', { status: to as 'Open' | 'InProgress' | 'Resolved' }),
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

      await service.updateIssue('org-1', 'issue-1', 'actor-1', { status: to as 'Open' | 'InProgress' | 'Resolved' });

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
      });
    });

    it('is a no-op for a same-status update (not treated as an invalid transition, and records no activity)', async () => {
      governanceIssues.findFirstById.mockResolvedValue({ ...baseIssue, status: 'Open' });
      governanceIssues.updateById.mockResolvedValue(baseIssue);

      await service.updateIssue('org-1', 'issue-1', 'actor-1', { status: 'Open' });

      expect(governanceIssues.updateById).toHaveBeenCalledWith('issue-1', {});
      expect(governanceActivityService.record).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when assignedUserId does not resolve to a user in this organization', async () => {
      governanceIssues.findFirstById.mockResolvedValue(baseIssue);
      users.findFirstById.mockResolvedValue(null);

      await expect(
        service.updateIssue('org-1', 'issue-1', 'actor-1', { assignedUserId: 'user-other-org' }),
      ).rejects.toThrow(BadRequestException);
      expect(governanceIssues.updateById).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when assigning to an inactive user', async () => {
      governanceIssues.findFirstById.mockResolvedValue(baseIssue);
      users.findFirstById.mockResolvedValue({ id: 'user-1', status: 'Deactivated' });

      await expect(
        service.updateIssue('org-1', 'issue-1', 'actor-1', { assignedUserId: 'user-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('assigns to a valid, active, organization-scoped user and records IssueAssigned when there was no previous assignee', async () => {
      governanceIssues.findFirstById.mockResolvedValue(baseIssue);
      users.findFirstById.mockResolvedValue({ id: 'user-1', status: 'Active', displayName: 'Sarah' });
      governanceIssues.updateById.mockResolvedValue({ ...baseIssue, assignedUserId: 'user-1' });
      documents.findMany.mockResolvedValue([]);

      await service.updateIssue('org-1', 'issue-1', 'actor-1', { assignedUserId: 'user-1' });

      expect(governanceIssues.updateById).toHaveBeenCalledWith('issue-1', { assignedUserId: 'user-1' });
      expect(governanceActivityService.record).toHaveBeenCalledWith('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'IssueAssigned',
        previousValue: null,
        newValue: 'Sarah',
      });
    });

    it('records AssigneeChanged (not IssueAssigned) when reassigning from one user to another', async () => {
      governanceIssues.findFirstById.mockResolvedValue({ ...baseIssue, assignedUserId: 'user-1' });
      users.findFirstById.mockImplementation(async (id: string) =>
        id === 'user-1' ? { id: 'user-1', displayName: 'Sarah' } : { id: 'user-2', status: 'Active', displayName: 'John' },
      );
      governanceIssues.updateById.mockResolvedValue({ ...baseIssue, assignedUserId: 'user-2' });
      documents.findMany.mockResolvedValue([]);

      await service.updateIssue('org-1', 'issue-1', 'actor-1', { assignedUserId: 'user-2' });

      expect(governanceActivityService.record).toHaveBeenCalledWith('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'AssigneeChanged',
        previousValue: 'Sarah',
        newValue: 'John',
      });
    });

    it('allows unassigning by passing assignedUserId: null and records AssigneeChanged with a null newValue', async () => {
      governanceIssues.findFirstById.mockResolvedValue({ ...baseIssue, assignedUserId: 'user-1' });
      users.findFirstById.mockResolvedValue({ id: 'user-1', displayName: 'Sarah' });
      governanceIssues.updateById.mockResolvedValue({ ...baseIssue, assignedUserId: null });
      documents.findMany.mockResolvedValue([]);

      await service.updateIssue('org-1', 'issue-1', 'actor-1', { assignedUserId: null });

      expect(governanceIssues.updateById).toHaveBeenCalledWith('issue-1', { assignedUserId: null });
      expect(governanceActivityService.record).toHaveBeenCalledWith('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'AssigneeChanged',
        previousValue: 'Sarah',
        newValue: null,
      });
    });

    it('updates resolutionNotes independently of status and records ResolutionNoteUpdated', async () => {
      governanceIssues.findFirstById.mockResolvedValue(baseIssue);
      governanceIssues.updateById.mockResolvedValue({ ...baseIssue, resolutionNotes: 'Fixed via reassignment' });
      documents.findMany.mockResolvedValue([]);

      await service.updateIssue('org-1', 'issue-1', 'actor-1', { resolutionNotes: 'Fixed via reassignment' });

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

      await service.updateIssue('org-1', 'issue-1', 'actor-1', { status: 'InProgress', assignedUserId: 'user-1' });

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
  });

  describe('getSummary', () => {
    const fixedNow = new Date('2026-07-15T12:00:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(fixedNow);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('counts open/inProgress/resolved/critical/assigned and groups open+inProgress by issueType', async () => {
      governanceIssues.findMany.mockResolvedValue([
        { status: 'Open', severity: 'RequiresReview', assignedUserId: 'user-1', issueType: 'Freshness', createdAt: new Date('2026-06-01T00:00:00.000Z'), resolvedAt: null },
        { status: 'Open', severity: 'NeedsAttention', assignedUserId: null, issueType: 'Ownership', createdAt: new Date('2026-06-01T00:00:00.000Z'), resolvedAt: null },
        { status: 'InProgress', severity: 'RequiresReview', assignedUserId: 'user-2', issueType: 'Freshness', createdAt: new Date('2026-06-01T00:00:00.000Z'), resolvedAt: null },
        { status: 'Resolved', severity: 'RequiresReview', assignedUserId: 'user-1', issueType: 'Freshness', createdAt: new Date('2026-06-01T00:00:00.000Z'), resolvedAt: new Date('2026-06-05T00:00:00.000Z') },
      ]);

      const result = await service.getSummary('org-1');

      expect(result).toEqual(
        expect.objectContaining({
          openCount: 2,
          inProgressCount: 1,
          resolvedCount: 1,
          criticalCount: 2, // Open+RequiresReview, InProgress+RequiresReview — Resolved excluded
          assignedCount: 2, // Open+assigned, InProgress+assigned — Resolved excluded
          byType: { Freshness: 2, Ownership: 1 }, // Resolved excluded from byType
          totalCount: 4,
          completionRate: 25,
        }),
      );
    });

    it('returns totalCount 0 and completionRate 0 when the organization has no governance issues', async () => {
      governanceIssues.findMany.mockResolvedValue([]);
      const result = await service.getSummary('org-1');
      expect(result.totalCount).toBe(0);
      expect(result.completionRate).toBe(0);
      expect(result.averageResolutionTimeHours).toBeNull();
    });

    it('computes averageResolutionTimeHours across currently Resolved issues only', async () => {
      governanceIssues.findMany.mockResolvedValue([
        { status: 'Resolved', severity: 'NeedsAttention', assignedUserId: null, issueType: 'Freshness', createdAt: new Date('2026-06-01T00:00:00.000Z'), resolvedAt: new Date('2026-06-02T00:00:00.000Z') }, // 24h
        { status: 'Resolved', severity: 'NeedsAttention', assignedUserId: null, issueType: 'Freshness', createdAt: new Date('2026-06-01T00:00:00.000Z'), resolvedAt: new Date('2026-06-04T00:00:00.000Z') }, // 72h
        { status: 'Open', severity: 'NeedsAttention', assignedUserId: null, issueType: 'Freshness', createdAt: new Date('2026-06-01T00:00:00.000Z'), resolvedAt: null }, // excluded — not Resolved
      ]);

      const result = await service.getSummary('org-1');

      expect(result.averageResolutionTimeHours).toBe(48);
    });

    it('counts createdThisMonth and resolvedThisMonth against the current UTC calendar month only', async () => {
      governanceIssues.findMany.mockResolvedValue([
        { status: 'Open', severity: 'NeedsAttention', assignedUserId: null, issueType: 'Freshness', createdAt: new Date('2026-07-10T00:00:00.000Z'), resolvedAt: null }, // this month
        { status: 'Open', severity: 'NeedsAttention', assignedUserId: null, issueType: 'Freshness', createdAt: new Date('2026-06-20T00:00:00.000Z'), resolvedAt: null }, // last month — excluded
        { status: 'Resolved', severity: 'NeedsAttention', assignedUserId: null, issueType: 'Freshness', createdAt: new Date('2026-06-25T00:00:00.000Z'), resolvedAt: new Date('2026-07-05T00:00:00.000Z') }, // resolved this month
        { status: 'Resolved', severity: 'NeedsAttention', assignedUserId: null, issueType: 'Freshness', createdAt: new Date('2026-06-01T00:00:00.000Z'), resolvedAt: new Date('2026-06-10T00:00:00.000Z') }, // resolved last month — excluded
      ]);

      const result = await service.getSummary('org-1');

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
