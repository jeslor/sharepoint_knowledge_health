import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
        assignedUserId: null,
      });
      expect(result.severity).toBe('RequiresReview');
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
        where.criterion === 'Freshness' ? [{ healthScoreId: 'score-1', criterion: 'Freshness', severity: 'RequiresReview' }] : [],
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
      });

      await service.createIssue('org-1', 'actor-1', { documentId: 'doc-1', issueType: 'Freshness' });

      expect(governanceIssues.create).toHaveBeenCalledWith({
        documentId: 'doc-1',
        issueType: 'Freshness',
        severity: 'RequiresReview',
        assignedUserId: 'user-1',
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
