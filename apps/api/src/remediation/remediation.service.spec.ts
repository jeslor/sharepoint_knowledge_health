import { BadRequestException } from '@nestjs/common';
import { createRemediationJobWithItems, createTenantContext } from '@sph/database';
import type { Queue } from 'bullmq';
import { RemediationService } from './remediation.service';
import { AuditLogService } from '../audit-log/audit-log.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;
const mockedCreateJobWithItems = createRemediationJobWithItems as jest.MockedFunction<typeof createRemediationJobWithItems>;

const defaultRequest = {
  issueType: 'ReviewStatus' as const,
  documentIds: ['doc-1', 'doc-2'],
  nextReviewDueAt: '2026-12-01T00:00:00.000Z',
};

function scoredDocument(id: string, currentHealthScoreId = `score-${id}`) {
  return { id, currentHealthScoreId };
}

describe('RemediationService', () => {
  const documents = { findMany: jest.fn() };
  const healthIssues = { findMany: jest.fn() };
  const remediationItems = { markSkippedForJob: jest.fn(), findMany: jest.fn(), groupByStatusForJobs: jest.fn() };
  const remediationJobs = { updateById: jest.fn(), findMany: jest.fn(), count: jest.fn(), findFirstById: jest.fn() };
  const users = { findMany: jest.fn() };
  const queue = { add: jest.fn() };
  const auditLog = { record: jest.fn() } as unknown as jest.Mocked<AuditLogService>;

  const service = new RemediationService(queue as unknown as Queue, auditLog);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({
      documents,
      healthIssues,
      remediationItems,
      remediationJobs,
      users,
    } as never);
    queue.add.mockResolvedValue(undefined); // enqueue succeeds by default
    documents.findMany.mockResolvedValue([scoredDocument('doc-1'), scoredDocument('doc-2')]);
    healthIssues.findMany.mockResolvedValue([
      { healthScoreId: 'score-doc-1', criterion: 'ReviewStatus' },
      { healthScoreId: 'score-doc-2', criterion: 'ReviewStatus' },
    ]);
    mockedCreateJobWithItems.mockResolvedValue({
      id: 'job-1',
      organizationId: 'org-1',
      issueType: 'ReviewStatus',
      totalCount: 2,
      succeededCount: 0,
      failedCount: 0,
      status: 'Running',
      payload: { nextReviewDueAt: defaultRequest.nextReviewDueAt },
      initiatedByUserId: 'user-1',
      initiatedByRole: 'Admin',
      createdAt: new Date(),
      completedAt: null,
      items: [],
    } as never);
  });

  describe('validation', () => {
    it('throws when issueType is missing', async () => {
      await expect(
        service.createRemediationJob('org-1', 'user-1', 'Admin', { ...defaultRequest, issueType: undefined as never }),
      ).rejects.toThrow(BadRequestException);
      expect(mockedCreateJobWithItems).not.toHaveBeenCalled();
    });

    it('throws when documentIds is empty', async () => {
      await expect(
        service.createRemediationJob('org-1', 'user-1', 'Admin', { ...defaultRequest, documentIds: [] }),
      ).rejects.toThrow(BadRequestException);
      expect(mockedCreateJobWithItems).not.toHaveBeenCalled();
    });

    it('throws when more than 500 document ids are submitted', async () => {
      const documentIds = Array.from({ length: 501 }, (_, i) => `doc-${i}`);
      await expect(
        service.createRemediationJob('org-1', 'user-1', 'Admin', { ...defaultRequest, documentIds }),
      ).rejects.toThrow(BadRequestException);
      expect(mockedCreateJobWithItems).not.toHaveBeenCalled();
    });

    it('allows exactly 500 unique document ids', async () => {
      const documentIds = Array.from({ length: 500 }, (_, i) => `doc-${i}`);
      documents.findMany.mockResolvedValue(documentIds.map((id) => scoredDocument(id)));
      healthIssues.findMany.mockResolvedValue(documentIds.map((id) => ({ healthScoreId: `score-${id}`, criterion: 'ReviewStatus' })));

      await service.createRemediationJob('org-1', 'user-1', 'Admin', { ...defaultRequest, documentIds });

      expect(mockedCreateJobWithItems).toHaveBeenCalledWith(expect.objectContaining({ documentIds }));
    });

    it('deduplicates document ids before any DB write', async () => {
      await service.createRemediationJob('org-1', 'user-1', 'Admin', {
        ...defaultRequest,
        documentIds: ['doc-1', 'doc-1', 'doc-2'],
      });

      expect(documents.findMany).toHaveBeenCalledWith({ where: { id: { in: ['doc-1', 'doc-2'] } } });
      expect(mockedCreateJobWithItems).toHaveBeenCalledWith(
        expect.objectContaining({ documentIds: ['doc-1', 'doc-2'] }),
      );
    });

    it('rejects a missing nextReviewDueAt', async () => {
      await expect(
        service.createRemediationJob('org-1', 'user-1', 'Admin', { ...defaultRequest, nextReviewDueAt: undefined as never }),
      ).rejects.toThrow(BadRequestException);
      expect(mockedCreateJobWithItems).not.toHaveBeenCalled();
    });

    it('rejects an invalid nextReviewDueAt', async () => {
      await expect(
        service.createRemediationJob('org-1', 'user-1', 'Admin', { ...defaultRequest, nextReviewDueAt: 'not-a-date' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockedCreateJobWithItems).not.toHaveBeenCalled();
    });

    it('accepts a valid ISO nextReviewDueAt and passes it through in the payload', async () => {
      await service.createRemediationJob('org-1', 'user-1', 'Admin', defaultRequest);

      expect(mockedCreateJobWithItems).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { nextReviewDueAt: defaultRequest.nextReviewDueAt } }),
      );
    });
  });

  describe('eligibility re-validation (ADR-0022 §8)', () => {
    it('marks a documentId not found in this organization as ineligible (covers cross-organization ids)', async () => {
      documents.findMany.mockResolvedValue([scoredDocument('doc-1')]); // doc-2 not returned — belongs to another org, or does not exist
      healthIssues.findMany.mockResolvedValue([{ healthScoreId: 'score-doc-1', criterion: 'ReviewStatus' }]);

      const result = await service.createRemediationJob('org-1', 'user-1', 'Admin', defaultRequest);

      expect(result.ineligibleDocumentIds).toEqual(['doc-2']);
      expect(mockedCreateJobWithItems).toHaveBeenCalledWith(expect.objectContaining({ documentIds: ['doc-1'] }));
    });

    it('marks a document with no currentHealthScoreId as ineligible', async () => {
      documents.findMany.mockResolvedValue([
        scoredDocument('doc-1'),
        { id: 'doc-2', currentHealthScoreId: null },
      ]);
      healthIssues.findMany.mockResolvedValue([{ healthScoreId: 'score-doc-1', criterion: 'ReviewStatus' }]);

      const result = await service.createRemediationJob('org-1', 'user-1', 'Admin', defaultRequest);

      expect(result.ineligibleDocumentIds).toEqual(['doc-2']);
      expect(mockedCreateJobWithItems).toHaveBeenCalledWith(expect.objectContaining({ documentIds: ['doc-1'] }));
    });

    it('marks a document without the requested current HealthIssue as ineligible', async () => {
      documents.findMany.mockResolvedValue([scoredDocument('doc-1'), scoredDocument('doc-2')]);
      // Only doc-1's current score has a matching ReviewStatus issue.
      healthIssues.findMany.mockResolvedValue([{ healthScoreId: 'score-doc-1', criterion: 'ReviewStatus' }]);

      const result = await service.createRemediationJob('org-1', 'user-1', 'Admin', defaultRequest);

      expect(result.ineligibleDocumentIds).toEqual(['doc-2']);
      expect(mockedCreateJobWithItems).toHaveBeenCalledWith(expect.objectContaining({ documentIds: ['doc-1'] }));
    });

    it('only eligible documents become RemediationItems, and every rejected id is reported back', async () => {
      documents.findMany.mockResolvedValue([scoredDocument('doc-1')]);
      healthIssues.findMany.mockResolvedValue([{ healthScoreId: 'score-doc-1', criterion: 'ReviewStatus' }]);

      const result = await service.createRemediationJob('org-1', 'user-1', 'Admin', defaultRequest);

      expect(result).toEqual({ remediationJobId: 'job-1', totalCount: 2, ineligibleDocumentIds: ['doc-2'] });
    });

    it('throws BadRequestException when no submitted documents are eligible, and never creates a job', async () => {
      documents.findMany.mockResolvedValue([]);

      await expect(service.createRemediationJob('org-1', 'user-1', 'Admin', defaultRequest)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockedCreateJobWithItems).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('successful creation + enqueue', () => {
    it('creates the job atomically via createRemediationJobWithItems with the actor/role/issueType/payload/eligible ids', async () => {
      await service.createRemediationJob('org-1', 'user-1', 'Admin', defaultRequest);

      expect(mockedCreateJobWithItems).toHaveBeenCalledWith({
        organizationId: 'org-1',
        issueType: 'ReviewStatus',
        payload: { nextReviewDueAt: defaultRequest.nextReviewDueAt },
        initiatedByUserId: 'user-1',
        initiatedByRole: 'Admin',
        documentIds: ['doc-1', 'doc-2'],
      });
    });

    it('enqueues a job carrying only { organizationId, remediationJobId }', async () => {
      await service.createRemediationJob('org-1', 'user-1', 'Admin', defaultRequest);

      expect(queue.add).toHaveBeenCalledWith('remediate', { organizationId: 'org-1', remediationJobId: 'job-1' });
    });

    it('returns remediationJobId, totalCount, and ineligibleDocumentIds', async () => {
      const result = await service.createRemediationJob('org-1', 'user-1', 'Admin', defaultRequest);

      expect(result).toEqual({ remediationJobId: 'job-1', totalCount: 2, ineligibleDocumentIds: [] });
    });

    it('records a remediation_job.initiated audit entry only once the job is genuinely enqueued', async () => {
      await service.createRemediationJob('org-1', 'user-1', 'Admin', defaultRequest);

      expect(auditLog.record).toHaveBeenCalledWith('org-1', {
        actorUserId: 'user-1',
        action: 'remediation_job.initiated',
        targetType: 'RemediationJob',
        targetId: 'job-1',
      });
    });
  });

  describe('when queue.add() fails (P0-2, Option A — locked decision)', () => {
    it('marks every item Skipped with errorType EnqueueFailed, marks the job Completed, and re-throws the original error', async () => {
      const enqueueError = new Error('connect ECONNREFUSED 127.0.0.1:6379');
      queue.add.mockRejectedValue(enqueueError);
      remediationItems.markSkippedForJob.mockResolvedValue(2);
      remediationJobs.updateById.mockResolvedValue({ id: 'job-1', status: 'Completed' });

      await expect(service.createRemediationJob('org-1', 'user-1', 'Admin', defaultRequest)).rejects.toBe(enqueueError);

      expect(remediationItems.markSkippedForJob).toHaveBeenCalledWith('job-1', {
        errorType: 'EnqueueFailed',
        errorMessage: 'Failed to enqueue remediation job: connect ECONNREFUSED 127.0.0.1:6379',
      });
      expect(remediationJobs.updateById).toHaveBeenCalledWith('job-1', {
        status: 'Completed',
        completedAt: expect.any(Date),
      });
    });

    it('never leaves the job permanently Running because of an enqueue failure', async () => {
      queue.add.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
      remediationItems.markSkippedForJob.mockResolvedValue(2);
      remediationJobs.updateById.mockResolvedValue({ id: 'job-1', status: 'Completed' });

      await expect(service.createRemediationJob('org-1', 'user-1', 'Admin', defaultRequest)).rejects.toThrow();

      expect(remediationJobs.updateById).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'Completed' }));
    });

    it('does not create a remediation_job.initiated audit entry when enqueue fails', async () => {
      queue.add.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
      remediationItems.markSkippedForJob.mockResolvedValue(2);
      remediationJobs.updateById.mockResolvedValue({ id: 'job-1', status: 'Completed' });

      await expect(service.createRemediationJob('org-1', 'user-1', 'Admin', defaultRequest)).rejects.toThrow();

      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('propagates the original enqueue error to the caller, not a compensating-write error', async () => {
      const enqueueError = new Error('connect ECONNREFUSED 127.0.0.1:6379');
      queue.add.mockRejectedValue(enqueueError);
      remediationItems.markSkippedForJob.mockRejectedValue(new Error('Postgres also unavailable'));

      await expect(service.createRemediationJob('org-1', 'user-1', 'Admin', defaultRequest)).rejects.toBe(enqueueError);
    });

    it('marks the job Completed and re-throws a timeout error when queue.add() never settles within the timeout window', async () => {
      jest.useFakeTimers();
      queue.add.mockReturnValue(new Promise(() => {})); // never settles
      remediationItems.markSkippedForJob.mockResolvedValue(2);
      remediationJobs.updateById.mockResolvedValue({ id: 'job-1', status: 'Completed' });

      const resultPromise = service.createRemediationJob('org-1', 'user-1', 'Admin', defaultRequest);
      const assertion = expect(resultPromise).rejects.toThrow('Redis enqueue timed out');

      await jest.advanceTimersByTimeAsync(10_000);
      await assertion;

      expect(remediationItems.markSkippedForJob).toHaveBeenCalledWith('job-1', {
        errorType: 'EnqueueFailed',
        errorMessage: 'Failed to enqueue remediation job: Redis enqueue timed out',
      });
      jest.useRealTimers();
    });
  });

  function jobRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'job-1',
      organizationId: 'org-1',
      issueType: 'ReviewStatus',
      totalCount: 2,
      succeededCount: 0,
      failedCount: 0,
      status: 'Running',
      payload: { nextReviewDueAt: '2026-12-01T00:00:00.000Z' },
      initiatedByUserId: 'user-1',
      initiatedByRole: 'Admin',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: null,
      ...overrides,
    };
  }

  describe('listRemediationJobs (P0-3)', () => {
    beforeEach(() => {
      remediationJobs.findMany.mockResolvedValue([jobRow()]);
      remediationJobs.count.mockResolvedValue(1);
      remediationItems.groupByStatusForJobs.mockResolvedValue([]);
      users.findMany.mockResolvedValue([{ id: 'user-1', displayName: 'Ada Admin' }]);
    });

    it('defaults to page 1 / pageSize 25, ordered by createdAt desc', async () => {
      await service.listRemediationJobs('org-1', {});

      expect(remediationJobs.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 25,
      });
    });

    it('computes skip from an explicit page/pageSize', async () => {
      await service.listRemediationJobs('org-1', { page: 3, pageSize: 10 });

      expect(remediationJobs.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        skip: 20,
        take: 10,
      });
    });

    it('returns pagination metadata derived from the total count', async () => {
      remediationJobs.count.mockResolvedValue(47);

      const result = await service.listRemediationJobs('org-1', { page: 2, pageSize: 20 });

      expect(result.pagination).toEqual({ page: 2, pageSize: 20, total: 47, totalPages: 3 });
    });

    it('returns totalPages of 1 (never 0) when there are no jobs at all', async () => {
      remediationJobs.findMany.mockResolvedValue([]);
      remediationJobs.count.mockResolvedValue(0);

      const result = await service.listRemediationJobs('org-1', {});

      expect(result).toEqual({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });
    });

    it('enriches each job with its initiator display name via a single batched users lookup', async () => {
      remediationJobs.findMany.mockResolvedValue([jobRow({ id: 'job-1', initiatedByUserId: 'user-1' }), jobRow({ id: 'job-2', initiatedByUserId: 'user-2' })]);
      users.findMany.mockResolvedValue([
        { id: 'user-1', displayName: 'Ada Admin' },
        { id: 'user-2', displayName: 'Gary Governance' },
      ]);

      const result = await service.listRemediationJobs('org-1', {});

      expect(users.findMany).toHaveBeenCalledTimes(1);
      expect(users.findMany).toHaveBeenCalledWith({ where: { id: { in: ['user-1', 'user-2'] } } });
      expect(result.data.map((job) => job.initiatedByUserName)).toEqual(['Ada Admin', 'Gary Governance']);
    });

    it('derives succeeded/failed/skipped counts live from groupByStatusForJobs, not from the job row\'s own (stale-while-Running) columns', async () => {
      remediationJobs.findMany.mockResolvedValue([jobRow({ succeededCount: 0, failedCount: 0, status: 'Running' })]);
      remediationItems.groupByStatusForJobs.mockResolvedValue([
        { remediationJobId: 'job-1', status: 'Succeeded', count: 5 },
        { remediationJobId: 'job-1', status: 'Failed', count: 2 },
        { remediationJobId: 'job-1', status: 'Skipped', count: 1 },
      ]);

      const result = await service.listRemediationJobs('org-1', {});

      expect(remediationItems.groupByStatusForJobs).toHaveBeenCalledWith(['job-1']);
      expect(result.data[0]).toEqual(
        expect.objectContaining({ succeededCount: 5, failedCount: 2, skippedCount: 1 }),
      );
    });

    it('reports zero counts for a job with no terminal items yet', async () => {
      remediationItems.groupByStatusForJobs.mockResolvedValue([]);

      const result = await service.listRemediationJobs('org-1', {});

      expect(result.data[0]).toEqual(
        expect.objectContaining({ succeededCount: 0, failedCount: 0, skippedCount: 0 }),
      );
    });

    it('extracts nextReviewDueAt from the job payload', async () => {
      const result = await service.listRemediationJobs('org-1', {});

      expect(result.data[0]?.nextReviewDueAt).toBe('2026-12-01T00:00:00.000Z');
    });

    it('returns null nextReviewDueAt for a malformed payload rather than throwing', async () => {
      remediationJobs.findMany.mockResolvedValue([jobRow({ payload: { somethingElse: true } })]);

      const result = await service.listRemediationJobs('org-1', {});

      expect(result.data[0]?.nextReviewDueAt).toBeNull();
    });
  });

  describe('getRemediationJob (P0-3)', () => {
    it('throws NotFoundException when the job does not exist in this organization (covers cross-organization ids)', async () => {
      remediationJobs.findFirstById.mockResolvedValue(null);

      await expect(service.getRemediationJob('org-1', 'job-1')).rejects.toThrow('Remediation job not found');
      expect(remediationItems.findMany).not.toHaveBeenCalled();
    });

    it('returns the job detail with item-level results', async () => {
      remediationJobs.findFirstById.mockResolvedValue(jobRow({ status: 'Completed', completedAt: new Date('2026-01-02T00:00:00.000Z') }));
      remediationItems.findMany.mockResolvedValue([
        { id: 'item-1', remediationJobId: 'job-1', documentId: 'doc-1', status: 'Succeeded', errorType: null, errorMessage: null, attemptCount: 1 },
        {
          id: 'item-2',
          remediationJobId: 'job-1',
          documentId: 'doc-2',
          status: 'Failed',
          errorType: 'GraphNotFoundError',
          errorMessage: 'The item was not found',
          attemptCount: 2,
        },
      ]);
      users.findMany.mockResolvedValue([{ id: 'user-1', displayName: 'Ada Admin' }]);

      const result = await service.getRemediationJob('org-1', 'job-1');

      expect(remediationItems.findMany).toHaveBeenCalledWith({ where: { remediationJobId: 'job-1' } });
      expect(result).toEqual({
        id: 'job-1',
        status: 'Completed',
        issueType: 'ReviewStatus',
        nextReviewDueAt: '2026-12-01T00:00:00.000Z',
        initiatedByUserId: 'user-1',
        initiatedByUserName: 'Ada Admin',
        totalCount: 2,
        succeededCount: 1,
        failedCount: 1,
        skippedCount: 0,
        createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
        completedAt: new Date('2026-01-02T00:00:00.000Z').toISOString(),
        items: [
          { documentId: 'doc-1', status: 'Succeeded', errorType: null, errorMessage: null, attemptCount: 1 },
          { documentId: 'doc-2', status: 'Failed', errorType: 'GraphNotFoundError', errorMessage: 'The item was not found', attemptCount: 2 },
        ],
      });
    });

    it('derives its counts from the already-loaded item set, never issuing a second groupByStatusForJobs query', async () => {
      remediationJobs.findFirstById.mockResolvedValue(jobRow());
      remediationItems.findMany.mockResolvedValue([
        { id: 'item-1', remediationJobId: 'job-1', documentId: 'doc-1', status: 'Skipped', errorType: 'EnqueueFailed', errorMessage: 'boom', attemptCount: 0 },
      ]);
      users.findMany.mockResolvedValue([{ id: 'user-1', displayName: 'Ada Admin' }]);

      const result = await service.getRemediationJob('org-1', 'job-1');

      expect(remediationItems.groupByStatusForJobs).not.toHaveBeenCalled();
      expect(result.skippedCount).toBe(1);
      expect(result.succeededCount).toBe(0);
      expect(result.failedCount).toBe(0);
    });
  });
});
