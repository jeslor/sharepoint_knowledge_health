import { createTenantContext } from '@sph/database';
import { GovernanceActivityService } from './governance-activity.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('GovernanceActivityService', () => {
  const service = new GovernanceActivityService();

  const governanceActivity = { findMany: jest.fn(), count: jest.fn(), create: jest.fn() };
  const documents = { findMany: jest.fn(), findFirstById: jest.fn() };
  const users = { findMany: jest.fn() };
  const notifications = { create: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ governanceActivity, documents, users, notifications } as never);
    governanceActivity.findMany.mockResolvedValue([]);
    governanceActivity.count.mockResolvedValue(0);
    documents.findMany.mockResolvedValue([]);
    documents.findFirstById.mockResolvedValue(null);
    users.findMany.mockResolvedValue([]);
  });

  describe('record', () => {
    it('creates a row with organizationId scoping delegated to the repository (ADR-0001)', async () => {
      await service.record('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'IssueCreated',
      });

      expect(mockedCreateContext).toHaveBeenCalledWith('org-1');
      expect(governanceActivity.create).toHaveBeenCalledWith({
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'IssueCreated',
        previousValue: null,
        newValue: null,
        metadata: undefined,
      });
    });

    it('defaults governanceIssueId to null for document-level (ownership) activity', async () => {
      await service.record('org-1', {
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'OwnerAssigned',
        newValue: 'Sarah',
      });

      expect(governanceActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({ governanceIssueId: null, newValue: 'Sarah' }),
      );
    });

    it('does not create a Notification when notifyUserId is not provided (ADR-0021 §3.2)', async () => {
      await service.record('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'IssueAssigned',
        newValue: 'Sarah',
      });

      expect(notifications.create).not.toHaveBeenCalled();
    });

    it.each(['IssueAssigned', 'AssigneeChanged', 'OwnerAssigned', 'IssueReopened'] as const)(
      'creates a Notification for the approved trigger set (%s)',
      async (activityType) => {
        await service.record('org-1', {
          governanceIssueId: 'issue-1',
          documentId: 'doc-1',
          actorUserId: 'actor-1',
          activityType,
          notifyUserId: 'user-recipient',
        });

        expect(notifications.create).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'user-recipient',
            governanceIssueId: 'issue-1',
            documentId: 'doc-1',
          }),
        );
      },
    );

    it.each(['IssueCreated', 'StatusChanged', 'ResolutionNoteUpdated', 'OwnerRemoved', 'IssueResolved'] as const)(
      'never creates a Notification for activity types outside the approved trigger set, even if notifyUserId is set (%s)',
      async (activityType) => {
        await service.record('org-1', {
          documentId: 'doc-1',
          actorUserId: 'actor-1',
          activityType,
          notifyUserId: 'user-recipient',
        });

        expect(notifications.create).not.toHaveBeenCalled();
      },
    );

    it('enriches the notification message with the human-readable issue type when provided', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1', name: 'Employee Handbook.docx' });

      await service.record('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'IssueAssigned',
        notifyUserId: 'user-recipient',
        notifyIssueType: 'ReviewStatus',
      });

      // Human-readable ("Review Status"), not the raw enum ("ReviewStatus").
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Review Status') }),
      );
      expect(users.findMany).not.toHaveBeenCalled();
    });

    it('enriches the notification message with the document name via one lookup on the notifying path only', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1', name: 'Employee Handbook.docx' });

      await service.record('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'IssueAssigned',
        notifyUserId: 'user-recipient',
      });

      expect(documents.findFirstById).toHaveBeenCalledWith('doc-1');
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Employee Handbook.docx') }),
      );
    });

    it('enriches the notification message with the project\'s established severity terminology (Critical/Warning, not the raw enum)', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1', name: 'Employee Handbook.docx' });

      await service.record('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'IssueAssigned',
        notifyUserId: 'user-recipient',
        notifyIssueType: 'Freshness',
        notifyIssueSeverity: 'RequiresReview',
      });

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'You were assigned a governance issue on "Employee Handbook.docx" (Freshness, Critical).' }),
      );
    });

    it('does not query documents at all when no notification will be created (non-notifiable activity type)', async () => {
      await service.record('org-1', {
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'IssueCreated',
      });

      expect(documents.findFirstById).not.toHaveBeenCalled();
    });

    it('does not query documents at all when notifyUserId is not provided', async () => {
      await service.record('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'IssueAssigned',
      });

      expect(documents.findFirstById).not.toHaveBeenCalled();
    });

    it('gracefully degrades to the unenriched message when the document lookup returns null, without throwing', async () => {
      documents.findFirstById.mockResolvedValue(null);

      await expect(
        service.record('org-1', {
          governanceIssueId: 'issue-1',
          documentId: 'doc-1',
          actorUserId: 'actor-1',
          activityType: 'IssueAssigned',
          notifyUserId: 'user-recipient',
          notifyIssueType: 'Freshness',
          notifyIssueSeverity: 'RequiresReview',
        }),
      ).resolves.toBeUndefined();

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'You were assigned a governance issue (Freshness, Critical).' }),
      );
    });

    it('enriches the OwnerAssigned notification with the document name too', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1', name: 'Employee Handbook.docx' });

      await service.record('org-1', {
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'OwnerAssigned',
        newValue: 'Sarah',
        notifyUserId: 'user-recipient',
      });

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'You were assigned as the owner of "Employee Handbook.docx".' }),
      );
    });

    it('still targets the governance issue via governanceIssueId/documentId on the notification row, unaffected by message enrichment (preserves existing click-through behavior)', async () => {
      documents.findFirstById.mockResolvedValue({ id: 'doc-1', name: 'Employee Handbook.docx' });

      await service.record('org-1', {
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        actorUserId: 'actor-1',
        activityType: 'IssueAssigned',
        notifyUserId: 'user-recipient',
        notifyIssueType: 'Freshness',
        notifyIssueSeverity: 'RequiresReview',
      });

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ governanceIssueId: 'issue-1', documentId: 'doc-1' }),
      );
    });

    // Phase D.2 review fix (Issue 3): notification creation is best-effort
    // and must never make an already-successful GovernanceActivity write
    // look like the whole operation failed.
    describe('notification failure is best-effort', () => {
      it('still creates the GovernanceActivity row even when notification creation throws', async () => {
        notifications.create.mockRejectedValue(new Error('DB connection lost'));

        await service.record('org-1', {
          governanceIssueId: 'issue-1',
          documentId: 'doc-1',
          actorUserId: 'actor-1',
          activityType: 'IssueAssigned',
          notifyUserId: 'user-recipient',
        });

        expect(governanceActivity.create).toHaveBeenCalledWith(
          expect.objectContaining({ activityType: 'IssueAssigned' }),
        );
      });

      it('resolves successfully (does not throw) when notification creation fails', async () => {
        notifications.create.mockRejectedValue(new Error('DB connection lost'));

        await expect(
          service.record('org-1', {
            governanceIssueId: 'issue-1',
            documentId: 'doc-1',
            actorUserId: 'actor-1',
            activityType: 'IssueAssigned',
            notifyUserId: 'user-recipient',
          }),
        ).resolves.toBeUndefined();
      });

      it('logs the notification failure', async () => {
        notifications.create.mockRejectedValue(new Error('DB connection lost'));
        const logSpy = jest.spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error');

        await service.record('org-1', {
          governanceIssueId: 'issue-1',
          documentId: 'doc-1',
          actorUserId: 'actor-1',
          activityType: 'IssueAssigned',
          notifyUserId: 'user-recipient',
        });

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('user-recipient'), expect.anything());
      });

      it('still propagates a failure from the primary GovernanceActivity write (not caught, unlike the notification)', async () => {
        governanceActivity.create.mockRejectedValue(new Error('constraint violation'));

        await expect(
          service.record('org-1', {
            governanceIssueId: 'issue-1',
            documentId: 'doc-1',
            actorUserId: 'actor-1',
            activityType: 'IssueAssigned',
            notifyUserId: 'user-recipient',
          }),
        ).rejects.toThrow('constraint violation');
        expect(notifications.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('listIssueActivity', () => {
    it('scopes the query to the given governanceIssueId and paginates', async () => {
      await service.listIssueActivity('org-1', 'issue-1', {});

      expect(governanceActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { governanceIssueId: 'issue-1' } }),
      );
    });

    it('orders by createdAt descending by default (most recent first)', async () => {
      await service.listIssueActivity('org-1', 'issue-1', {});

      expect(governanceActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('applies activityType and since/until date filters', async () => {
      await service.listIssueActivity('org-1', 'issue-1', {
        activityType: 'StatusChanged',
        since: '2026-07-01T00:00:00.000Z',
        until: '2026-07-31T00:00:00.000Z',
      });

      expect(governanceActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            governanceIssueId: 'issue-1',
            activityType: 'StatusChanged',
            createdAt: { gte: new Date('2026-07-01T00:00:00.000Z'), lte: new Date('2026-07-31T00:00:00.000Z') },
          },
        }),
      );
    });
  });

  describe('listOrganizationActivity', () => {
    it('does not scope to any single governanceIssueId', async () => {
      await service.listOrganizationActivity('org-1', {});

      expect(governanceActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });

    it('enriches each activity with documentName and actorUserName in batch (no N+1)', async () => {
      governanceActivity.findMany.mockResolvedValue([
        {
          id: 'activity-1',
          governanceIssueId: 'issue-1',
          documentId: 'doc-1',
          actorUserId: 'user-1',
          activityType: 'IssueCreated',
          previousValue: null,
          newValue: null,
          metadata: null,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
        {
          id: 'activity-2',
          governanceIssueId: 'issue-1',
          documentId: 'doc-1',
          actorUserId: 'user-1',
          activityType: 'StatusChanged',
          previousValue: 'Open',
          newValue: 'InProgress',
          metadata: null,
          createdAt: new Date('2026-07-02T00:00:00.000Z'),
        },
      ]);
      documents.findMany.mockResolvedValue([{ id: 'doc-1', name: 'Handbook.docx' }]);
      users.findMany.mockResolvedValue([{ id: 'user-1', displayName: 'Sarah' }]);

      const result = await service.listOrganizationActivity('org-1', {});

      // Batched exactly once each, regardless of how many activity rows share a document/actor.
      expect(documents.findMany).toHaveBeenCalledTimes(1);
      expect(users.findMany).toHaveBeenCalledTimes(1);
      expect(result.data).toEqual([
        expect.objectContaining({ id: 'activity-1', documentName: 'Handbook.docx', actorUserName: 'Sarah' }),
        expect.objectContaining({ id: 'activity-2', documentName: 'Handbook.docx', actorUserName: 'Sarah' }),
      ]);
    });

    it('falls back to a friendly placeholder when a document or actor cannot be resolved', async () => {
      governanceActivity.findMany.mockResolvedValue([
        {
          id: 'activity-1',
          governanceIssueId: null,
          documentId: 'doc-missing',
          actorUserId: 'user-missing',
          activityType: 'OwnerAssigned',
          previousValue: null,
          newValue: 'Sarah',
          metadata: null,
          createdAt: new Date(),
        },
      ]);

      const result = await service.listOrganizationActivity('org-1', {});

      expect(result.data[0]).toEqual(
        expect.objectContaining({ documentName: 'Unknown document', actorUserName: 'Unknown user' }),
      );
    });
  });

  describe('tenant isolation', () => {
    it('only reads this organization\'s tenant context (org isolation via createTenantContext)', async () => {
      await service.listOrganizationActivity('org-42', {});
      expect(mockedCreateContext).toHaveBeenCalledWith('org-42');
    });
  });
});
