import { createTenantContext } from '@sph/database';
import { GovernanceActivityService } from './governance-activity.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('GovernanceActivityService', () => {
  const service = new GovernanceActivityService();

  const governanceActivity = { findMany: jest.fn(), count: jest.fn(), create: jest.fn() };
  const documents = { findMany: jest.fn() };
  const users = { findMany: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ governanceActivity, documents, users } as never);
    governanceActivity.findMany.mockResolvedValue([]);
    governanceActivity.count.mockResolvedValue(0);
    documents.findMany.mockResolvedValue([]);
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
