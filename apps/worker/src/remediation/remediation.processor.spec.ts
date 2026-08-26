import type { Job, Queue } from 'bullmq';
import type { RemediationJobPayload } from '@sph/types';
import { createTenantContext } from '@sph/database';
import { GraphNotFoundError, GraphPermissionError, GraphThrottledError, GraphTransientError, GraphAuthenticationError } from '@sph/graph-client';
import { RemediationProcessor } from './remediation.processor';
import { executeSetReviewDateAction } from './set-review-date.action';

jest.mock('@sph/database', () => ({
  ...jest.requireActual('@sph/database'),
  createTenantContext: jest.fn(),
}));
jest.mock('./set-review-date.action');

const mockedCreateTenantContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;
const mockedExecuteAction = executeSetReviewDateAction as jest.MockedFunction<typeof executeSetReviewDateAction>;

interface FakeItemRow {
  id: string;
  organizationId: string;
  remediationJobId: string;
  documentId: string;
  status: 'Pending' | 'Succeeded' | 'Failed' | 'Skipped';
  errorType: string | null;
  errorMessage: string | null;
  attemptCount: number;
}

function makeItem(overrides: Partial<FakeItemRow> = {}): FakeItemRow {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    organizationId: 'org-1',
    remediationJobId: 'job-1',
    documentId: `doc-${Math.random().toString(36).slice(2)}`,
    status: 'Pending',
    errorType: null,
    errorMessage: null,
    attemptCount: 0,
    ...overrides,
  };
}

// A light, stateful fake — not a bare jest.fn() stub — because the
// crash/resume, partial-success, and duplicate-delivery scenarios below
// need realistic read-your-own-writes behavior across more than one
// process() invocation sharing the same underlying "table."
function createFakeRemediationItemsRepo(initial: FakeItemRow[]) {
  const rows = new Map(initial.map((r) => [r.id, { ...r }]));

  return {
    findMany: jest.fn(async (args?: { where?: { status?: string } }) => {
      return [...rows.values()].filter((r) => args?.where?.status === undefined || r.status === args.where.status);
    }),
    count: jest.fn(async (args?: { where?: { status?: string } }) => {
      return [...rows.values()].filter((r) => args?.where?.status === undefined || r.status === args.where.status).length;
    }),
    findFirstById: jest.fn(async (id: string) => rows.get(id) ?? null),
    updateById: jest.fn(async (id: string, data: Record<string, unknown>) => {
      const row = rows.get(id);
      if (!row) return null;
      const patch = { ...data };
      const attemptCountPatch = patch.attemptCount as { increment?: number } | number | undefined;
      if (attemptCountPatch && typeof attemptCountPatch === 'object' && 'increment' in attemptCountPatch) {
        row.attemptCount += attemptCountPatch.increment ?? 0;
        delete patch.attemptCount;
      }
      Object.assign(row, patch);
      return { ...row };
    }),
    rows,
  };
}

function createFakeRemediationJobsRepo(initial: { id: string; organizationId: string; status: 'Running' | 'Completed'; payload: unknown }) {
  const job = { ...initial, succeededCount: 0, failedCount: 0, completedAt: null as Date | null };
  return {
    findFirstById: jest.fn(async (id: string) => (id === job.id ? { ...job } : null)),
    markCompletedIfRunning: jest.fn(async (id: string, data: Record<string, unknown>) => {
      if (id !== job.id || job.status !== 'Running') return { advanced: false };
      Object.assign(job, data, { status: 'Completed' });
      return { advanced: true };
    }),
    job,
  };
}

function makeDocument(id: string) {
  return { id, organizationId: 'org-1', name: `Doc ${id}.docx` };
}

function job(payload: RemediationJobPayload): Job<RemediationJobPayload> {
  return { id: 'bullmq-job-1', data: payload } as Job<RemediationJobPayload>;
}

const defaultPayload = { nextReviewDueAt: '2026-12-01T00:00:00.000Z' };

describe('RemediationProcessor (ADR-0022 Phase 4)', () => {
  let reconciliationQueue: jest.Mocked<Pick<Queue, 'add'>>;
  let processor: RemediationProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    reconciliationQueue = { add: jest.fn().mockResolvedValue(undefined) };
    processor = new RemediationProcessor(reconciliationQueue as unknown as Queue);
    delete process.env.REMEDIATION_WORKER_CONCURRENCY;
  });

  function wireContext(
    itemsRepo: ReturnType<typeof createFakeRemediationItemsRepo>,
    jobsRepo: ReturnType<typeof createFakeRemediationJobsRepo>,
    documents: Record<string, ReturnType<typeof makeDocument> | undefined> = {},
  ): void {
    mockedCreateTenantContext.mockReturnValue({
      organizationId: 'org-1',
      remediationJobs: jobsRepo,
      remediationItems: itemsRepo,
      documents: { findFirstById: jest.fn(async (id: string) => documents[id] ?? null) },
      microsoftTenants: { findMany: jest.fn().mockResolvedValue([{ entraTenantId: 'entra-1' }]) },
    } as never);
  }

  it('1. does nothing when the RemediationJob does not exist', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    jobsRepo.findFirstById.mockResolvedValue(null);
    const itemsRepo = createFakeRemediationItemsRepo([]);
    wireContext(itemsRepo, jobsRepo);

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(itemsRepo.findMany).not.toHaveBeenCalled();
    expect(mockedExecuteAction).not.toHaveBeenCalled();
  });

  it("2. does nothing when the job belongs to a different organization (the tenant-scoped repository's findFirstById returns null)", async () => {
    // createTenantContext(organizationId) already binds every repository to
    // one org (ADR-0001) — a job created under a different org is simply
    // never found, exactly like every other tenant-scoped lookup in this
    // codebase. Simulated here the same way: findFirstById resolves null.
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-2', status: 'Running', payload: defaultPayload });
    jobsRepo.findFirstById.mockResolvedValue(null);
    const itemsRepo = createFakeRemediationItemsRepo([]);
    wireContext(itemsRepo, jobsRepo);

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(mockedExecuteAction).not.toHaveBeenCalled();
  });

  it('3. when every item is already terminal, processes nothing but still completes the job', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([
      makeItem({ id: 'item-1', status: 'Succeeded' }),
      makeItem({ id: 'item-2', status: 'Failed' }),
    ]);
    wireContext(itemsRepo, jobsRepo);

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(mockedExecuteAction).not.toHaveBeenCalled();
    expect(jobsRepo.job.status).toBe('Completed');
    expect(jobsRepo.job.succeededCount).toBe(1);
    expect(jobsRepo.job.failedCount).toBe(1);
  });

  it('4. processes Pending items by calling executeSetReviewDateAction with the resolved document and job payload', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-1' })]);
    wireContext(itemsRepo, jobsRepo, { 'doc-1': makeDocument('doc-1') });
    mockedExecuteAction.mockResolvedValue({ outcome: 'verified' });

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(mockedExecuteAction).toHaveBeenCalledWith(
      { entraTenantId: 'entra-1', tenantContext: expect.anything() },
      expect.objectContaining({ id: 'doc-1' }),
      defaultPayload,
    );
    expect(itemsRepo.rows.get('item-1')?.status).toBe('Succeeded');
  });

  it('5. never re-fetches or re-processes an already-Succeeded item (only Pending items are ever loaded)', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([
      makeItem({ id: 'item-succeeded', status: 'Succeeded', documentId: 'doc-old' }),
      makeItem({ id: 'item-pending', status: 'Pending', documentId: 'doc-new' }),
    ]);
    wireContext(itemsRepo, jobsRepo, { 'doc-new': makeDocument('doc-new') });
    mockedExecuteAction.mockResolvedValue({ outcome: 'verified' });

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(itemsRepo.findMany).toHaveBeenCalledWith({ where: { remediationJobId: 'job-1', status: 'Pending' } });
    expect(mockedExecuteAction).toHaveBeenCalledTimes(1);
    expect(mockedExecuteAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'doc-new' }), expect.anything());
  });

  it('6. never re-processes an already-Failed (terminal) item', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-failed', status: 'Failed', errorType: 'GraphPermissionError' })]);
    wireContext(itemsRepo, jobsRepo);

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(mockedExecuteAction).not.toHaveBeenCalled();
    expect(itemsRepo.rows.get('item-failed')?.status).toBe('Failed'); // untouched
  });

  it('7. worker crash/resume: a second, later invocation against the same job only touches items still Pending, never re-touching what an earlier invocation already finished', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    // Represents Postgres's state right after a first invocation crashed
    // partway: item-a already reached a terminal state before the crash;
    // item-b/item-c never got attempted and are still exactly as created.
    const itemsRepo = createFakeRemediationItemsRepo([
      makeItem({ id: 'item-a', documentId: 'doc-a', status: 'Succeeded', attemptCount: 1 }),
      makeItem({ id: 'item-b', documentId: 'doc-b' }),
      makeItem({ id: 'item-c', documentId: 'doc-c' }),
    ]);
    wireContext(itemsRepo, jobsRepo, { 'doc-a': makeDocument('doc-a'), 'doc-b': makeDocument('doc-b'), 'doc-c': makeDocument('doc-c') });
    mockedExecuteAction.mockResolvedValue({ outcome: 'verified' });

    // The "resumed" invocation — a fresh BullMQ retry of the same job after
    // the crash, reloading state fresh from Postgres rather than trusting
    // anything about what the previous, crashed attempt did in memory.
    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(itemsRepo.findMany).toHaveBeenCalledWith({ where: { remediationJobId: 'job-1', status: 'Pending' } });
    expect(mockedExecuteAction).toHaveBeenCalledTimes(2); // only b and c
    expect(mockedExecuteAction).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'doc-a' }), expect.anything());
    expect(itemsRepo.rows.get('item-a')?.attemptCount).toBe(1); // untouched by this invocation
    expect(itemsRepo.rows.get('item-b')?.status).toBe('Succeeded');
    expect(itemsRepo.rows.get('item-c')?.status).toBe('Succeeded');
    expect(jobsRepo.job.status).toBe('Completed');
    expect(jobsRepo.job.succeededCount).toBe(3); // all three, including the one from before the crash
  });

  it('8. respects bounded concurrency — never exceeds REMEDIATION_WORKER_CONCURRENCY in-flight items', async () => {
    process.env.REMEDIATION_WORKER_CONCURRENCY = '2';
    const items = Array.from({ length: 6 }, (_, i) => makeItem({ id: `item-${i}`, documentId: `doc-${i}` }));
    const documents = Object.fromEntries(items.map((item) => [item.documentId, makeDocument(item.documentId)]));
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo(items);
    wireContext(itemsRepo, jobsRepo, documents);

    let concurrent = 0;
    let maxConcurrent = 0;
    mockedExecuteAction.mockImplementation(async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
      return { outcome: 'verified' };
    });

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(mockedExecuteAction).toHaveBeenCalledTimes(6);
  });

  it('9. partial success: some items Succeeded, some Failed, job still reaches Completed', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([
      makeItem({ id: 'item-ok', documentId: 'doc-ok' }),
      makeItem({ id: 'item-bad', documentId: 'doc-bad' }),
    ]);
    wireContext(itemsRepo, jobsRepo, { 'doc-ok': makeDocument('doc-ok'), 'doc-bad': makeDocument('doc-bad') });
    mockedExecuteAction.mockImplementation(async (_ctx, document) => {
      if (document.id === 'doc-bad') throw new GraphPermissionError('Access denied');
      return { outcome: 'verified' };
    });

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(itemsRepo.rows.get('item-ok')?.status).toBe('Succeeded');
    expect(itemsRepo.rows.get('item-bad')?.status).toBe('Failed');
    expect(jobsRepo.job.status).toBe('Completed');
    expect(jobsRepo.job.succeededCount).toBe(1);
    expect(jobsRepo.job.failedCount).toBe(1);
  });

  it('10. all-success: job completes and every item is Succeeded', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-1' }), makeItem({ id: 'item-2', documentId: 'doc-2' })]);
    wireContext(itemsRepo, jobsRepo, { 'doc-1': makeDocument('doc-1'), 'doc-2': makeDocument('doc-2') });
    mockedExecuteAction.mockResolvedValue({ outcome: 'verified' });

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(jobsRepo.job.status).toBe('Completed');
    expect(jobsRepo.job.succeededCount).toBe(2);
    expect(jobsRepo.job.failedCount).toBe(0);
    expect(reconciliationQueue.add).toHaveBeenCalledWith('reconcile-org', { organizationId: 'org-1' });
  });

  it('11. GraphPermissionError marks the item Failed with the error type preserved, and does not fail the job', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-1' })]);
    wireContext(itemsRepo, jobsRepo, { 'doc-1': makeDocument('doc-1') });
    mockedExecuteAction.mockRejectedValue(new GraphPermissionError('Access denied', 'accessDenied'));

    await expect(processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }))).resolves.toBeUndefined();

    expect(itemsRepo.rows.get('item-1')?.status).toBe('Failed');
    expect(itemsRepo.rows.get('item-1')?.errorType).toBe('GraphPermissionError');
  });

  it('12. GraphNotFoundError marks the item Failed with the error type preserved', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-1' })]);
    wireContext(itemsRepo, jobsRepo, { 'doc-1': makeDocument('doc-1') });
    mockedExecuteAction.mockRejectedValue(new GraphNotFoundError('Item not found', 'itemNotFound'));

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(itemsRepo.rows.get('item-1')?.status).toBe('Failed');
    expect(itemsRepo.rows.get('item-1')?.errorType).toBe('GraphNotFoundError');
  });

  it('13. GraphThrottledError leaves the item Pending (retryable), recording the error for observability', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-1' })]);
    wireContext(itemsRepo, jobsRepo, { 'doc-1': makeDocument('doc-1') });
    mockedExecuteAction.mockRejectedValue(new GraphThrottledError('Throttled', 'activityLimitReached'));

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(itemsRepo.rows.get('item-1')?.status).toBe('Pending');
    expect(itemsRepo.rows.get('item-1')?.errorType).toBe('GraphThrottledError');
    expect(itemsRepo.rows.get('item-1')?.attemptCount).toBe(1);
    expect(jobsRepo.job.status).toBe('Running'); // not completed — still Pending work
  });

  it('14. GraphTransientError leaves the item Pending (retryable)', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-1' })]);
    wireContext(itemsRepo, jobsRepo, { 'doc-1': makeDocument('doc-1') });
    mockedExecuteAction.mockRejectedValue(new GraphTransientError('Bad gateway', 'internalServerError'));

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(itemsRepo.rows.get('item-1')?.status).toBe('Pending');
    expect(itemsRepo.rows.get('item-1')?.errorType).toBe('GraphTransientError');
  });

  it('15. GraphAuthenticationError is an infrastructure failure — propagates and fails the whole job, never classified as a per-item outcome', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-1' })]);
    wireContext(itemsRepo, jobsRepo, { 'doc-1': makeDocument('doc-1') });
    const authError = new GraphAuthenticationError('Access token is empty', 'InvalidAuthenticationToken');
    mockedExecuteAction.mockRejectedValue(authError);

    await expect(processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }))).rejects.toBe(authError);

    expect(itemsRepo.rows.get('item-1')?.status).toBe('Pending'); // untouched — never marked Failed
    expect(jobsRepo.job.status).toBe('Running'); // never completed
  });

  it('16. a genuinely unexpected (non-Graph) error from the action propagates and fails the job, rather than being silently swallowed as Failed', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-1' })]);
    wireContext(itemsRepo, jobsRepo, { 'doc-1': makeDocument('doc-1') });
    // A precondition failure thrown by SetReviewDateAction itself (Phase 3)
    // — a plain Error, not a GraphClientError — is classified as Skipped
    // (structurally ineligible), which IS handled at the item level; this
    // test instead simulates a truly unrecognized non-Error rejection,
    // which must not be silently absorbed either.
    mockedExecuteAction.mockRejectedValue('a non-Error throw');

    await expect(processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }))).rejects.toBe('a non-Error throw');
    expect(itemsRepo.rows.get('item-1')?.status).toBe('Pending');
  });

  it("16b. a plain Error thrown by the action for a structurally-ineligible document (e.g. missing graphListId) is classified as Skipped, not Failed or unexpected", async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-1' })]);
    wireContext(itemsRepo, jobsRepo, { 'doc-1': makeDocument('doc-1') });
    mockedExecuteAction.mockRejectedValue(new Error('Document doc-1 has no graphListId — not eligible for review-date remediation'));

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(itemsRepo.rows.get('item-1')?.status).toBe('Skipped');
    expect(itemsRepo.rows.get('item-1')?.errorType).toBe('Error');
  });

  it('17. write succeeded but verification did not confirm the value — item stays Pending, never Failed or Succeeded', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-1' })]);
    wireContext(itemsRepo, jobsRepo, { 'doc-1': makeDocument('doc-1') });
    mockedExecuteAction.mockResolvedValue({ outcome: 'unverified' });

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(itemsRepo.rows.get('item-1')?.status).toBe('Pending');
    expect(itemsRepo.rows.get('item-1')?.attemptCount).toBe(1);
    expect(jobsRepo.job.status).toBe('Running');
  });

  it('18. item state is persisted immediately after each outcome, not batched at the end', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-1' })]);
    wireContext(itemsRepo, jobsRepo, { 'doc-1': makeDocument('doc-1') });
    mockedExecuteAction.mockResolvedValue({ outcome: 'verified' });

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(itemsRepo.updateById).toHaveBeenCalledWith('item-1', expect.objectContaining({ status: 'Succeeded' }));
  });

  it('19. a duplicate processor execution for an already-Completed job does nothing and does not re-enqueue reconciliation', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Completed', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', status: 'Succeeded' })]);
    wireContext(itemsRepo, jobsRepo);

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(itemsRepo.findMany).not.toHaveBeenCalled();
    expect(reconciliationQueue.add).not.toHaveBeenCalled();
  });

  it('19b. duplicate delivery that both reach finalization only enqueues reconciliation once (markCompletedIfRunning gates it)', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-1' })]);
    wireContext(itemsRepo, jobsRepo, { 'doc-1': makeDocument('doc-1') });
    mockedExecuteAction.mockResolvedValue({ outcome: 'verified' });

    // First invocation completes the job for real.
    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));
    expect(reconciliationQueue.add).toHaveBeenCalledTimes(1);

    // A second, duplicate delivery of the same (now-Completed) job.
    reconciliationQueue.add.mockClear();
    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(reconciliationQueue.add).not.toHaveBeenCalled();
  });

  it('20. enqueues notification reconciliation exactly once, only on the invocation that completes the job', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-1' })]);
    wireContext(itemsRepo, jobsRepo, { 'doc-1': makeDocument('doc-1') });
    mockedExecuteAction.mockResolvedValue({ outcome: 'verified' });

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(reconciliationQueue.add).toHaveBeenCalledTimes(1);
    expect(reconciliationQueue.add).toHaveBeenCalledWith('reconcile-org', { organizationId: 'org-1' });
  });

  it('does not enqueue reconciliation, and does not fail the job, when the reconciliation enqueue itself throws (best-effort)', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-1' })]);
    wireContext(itemsRepo, jobsRepo, { 'doc-1': makeDocument('doc-1') });
    mockedExecuteAction.mockResolvedValue({ outcome: 'verified' });
    reconciliationQueue.add.mockRejectedValue(new Error('Redis unavailable'));

    await expect(processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }))).resolves.toBeUndefined();
    expect(jobsRepo.job.status).toBe('Completed'); // the job itself still completed successfully
  });

  it('a missing/deleted Document is Skipped, not silently marked Succeeded', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: defaultPayload });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-missing' })]);
    wireContext(itemsRepo, jobsRepo, {}); // no document registered

    await processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }));

    expect(mockedExecuteAction).not.toHaveBeenCalled();
    expect(itemsRepo.rows.get('item-1')?.status).toBe('Skipped');
    expect(itemsRepo.rows.get('item-1')?.errorType).toBe('DocumentNotFound');
  });

  it('a malformed job payload (missing nextReviewDueAt) fails the whole job rather than any one item', async () => {
    const jobsRepo = createFakeRemediationJobsRepo({ id: 'job-1', organizationId: 'org-1', status: 'Running', payload: { wrongKey: true } });
    const itemsRepo = createFakeRemediationItemsRepo([makeItem({ id: 'item-1', documentId: 'doc-1' })]);
    wireContext(itemsRepo, jobsRepo, { 'doc-1': makeDocument('doc-1') });

    await expect(processor.process(job({ organizationId: 'org-1', remediationJobId: 'job-1' }))).rejects.toThrow(/malformed payload/);
    expect(mockedExecuteAction).not.toHaveBeenCalled();
  });
});
