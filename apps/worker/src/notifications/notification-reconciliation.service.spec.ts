import { createTenantContext } from '@sph/database';
import { NotificationReconciliationService, RECONCILIATION_BATCH_SIZE } from './notification-reconciliation.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

function issue(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'issue-1',
    organizationId: 'org-1',
    documentId: 'doc-1',
    issueType: 'Freshness',
    severity: 'RequiresReview',
    status: 'Open',
    assignedUserId: 'user-1',
    resolutionNotes: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    resolvedAt: null,
    ...overrides,
  };
}

describe('NotificationReconciliationService', () => {
  const governanceIssues = { findMany: jest.fn(), updateById: jest.fn() };
  const documents = { findMany: jest.fn() };
  const healthIssues = { findMany: jest.fn() };
  const notifications = { upsertByDedupeKey: jest.fn() };

  const service = new NotificationReconciliationService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ governanceIssues, documents, healthIssues, notifications } as never);

    governanceIssues.findMany.mockResolvedValue([]);
    documents.findMany.mockResolvedValue([]);
    healthIssues.findMany.mockResolvedValue([]);
    notifications.upsertByDedupeKey.mockResolvedValue({ id: 'notification-1' });
  });

  it('does nothing when there are no Open/InProgress GovernanceIssues', async () => {
    await service.reconcileForOrganization('org-1');

    expect(governanceIssues.findMany).toHaveBeenCalledWith({
      where: { status: { in: ['Open', 'InProgress'] } },
      orderBy: { id: 'asc' },
      take: 500,
    });
    expect(notifications.upsertByDedupeKey).not.toHaveBeenCalled();
  });

  it('upserts a ResolutionSuggested notification keyed on (issueId, updatedAt) when a rescan no longer detects the issue', async () => {
    governanceIssues.findMany.mockResolvedValue([issue()]);
    documents.findMany.mockResolvedValue([{ id: 'doc-1', currentHealthScoreId: 'score-current' }]);
    healthIssues.findMany.mockResolvedValue([]); // nothing currently detected for score-current

    await service.reconcileForOrganization('org-1');

    expect(notifications.upsertByDedupeKey).toHaveBeenCalledWith({
      dedupeKey: `issue-1:${issue().updatedAt.getTime()}`,
      userId: 'user-1',
      type: 'ResolutionSuggested',
      message: expect.stringContaining('Freshness'),
      governanceIssueId: 'issue-1',
      documentId: 'doc-1',
    });
  });

  it('does not attempt a notification when the issue is still detected by the current health score', async () => {
    governanceIssues.findMany.mockResolvedValue([issue()]);
    documents.findMany.mockResolvedValue([{ id: 'doc-1', currentHealthScoreId: 'score-current' }]);
    healthIssues.findMany.mockResolvedValue([{ healthScoreId: 'score-current', criterion: 'Freshness' }]);

    await service.reconcileForOrganization('org-1');

    expect(notifications.upsertByDedupeKey).not.toHaveBeenCalled();
  });

  it('treats a document with no currentHealthScoreId as not-detected, matching enrichIssues\' own ternary exactly', async () => {
    governanceIssues.findMany.mockResolvedValue([issue()]);
    documents.findMany.mockResolvedValue([{ id: 'doc-1', currentHealthScoreId: null }]);

    await service.reconcileForOrganization('org-1');

    expect(notifications.upsertByDedupeKey).toHaveBeenCalledTimes(1);
  });

  it('skips an issue with no assignedUserId — no resolvable recipient (ADR-0021 §3.2)', async () => {
    governanceIssues.findMany.mockResolvedValue([issue({ assignedUserId: null })]);
    documents.findMany.mockResolvedValue([{ id: 'doc-1', currentHealthScoreId: 'score-current' }]);
    healthIssues.findMany.mockResolvedValue([]);

    await service.reconcileForOrganization('org-1');

    expect(notifications.upsertByDedupeKey).not.toHaveBeenCalled();
  });

  // Phase D.2 review fix (Issue 1): the old check-then-create pattern (a
  // separate findMany dedup check before create) was replaced by an atomic
  // upsertByDedupeKey — the actual concurrency guarantee now lives in the
  // database's unique constraint on Notification.dedupeKey, proven against
  // a real Postgres instance in
  // packages/database/src/repositories/notification-repository.spec.ts,
  // not something a mocked unit test can meaningfully demonstrate. These
  // tests instead prove this service computes the dedupeKey correctly —
  // the part that IS this service's responsibility.
  it('computes the same dedupeKey for the same issue generation, so two calls for an unchanged issue would collide on the same DB row', async () => {
    governanceIssues.findMany.mockResolvedValue([issue()]);
    documents.findMany.mockResolvedValue([{ id: 'doc-1', currentHealthScoreId: 'score-current' }]);
    healthIssues.findMany.mockResolvedValue([]);

    await service.reconcileForOrganization('org-1');
    await service.reconcileForOrganization('org-1');

    const [firstCall] = notifications.upsertByDedupeKey.mock.calls[0] as [{ dedupeKey: string }];
    const [secondCall] = notifications.upsertByDedupeKey.mock.calls[1] as [{ dedupeKey: string }];
    expect(firstCall.dedupeKey).toBe(secondCall.dedupeKey);
  });

  it('computes a different dedupeKey after the issue is reopened (updatedAt changes) — a genuine new suggestion is never blocked', async () => {
    governanceIssues.findMany.mockResolvedValueOnce([issue({ updatedAt: new Date('2026-07-01T00:00:00.000Z') })]);
    documents.findMany.mockResolvedValue([{ id: 'doc-1', currentHealthScoreId: 'score-current' }]);
    healthIssues.findMany.mockResolvedValue([]);
    await service.reconcileForOrganization('org-1');

    governanceIssues.findMany.mockResolvedValueOnce([issue({ updatedAt: new Date('2026-07-05T00:00:00.000Z') })]); // reopened later
    await service.reconcileForOrganization('org-1');

    const [firstCall] = notifications.upsertByDedupeKey.mock.calls[0] as [{ dedupeKey: string }];
    const [secondCall] = notifications.upsertByDedupeKey.mock.calls[1] as [{ dedupeKey: string }];
    expect(firstCall.dedupeKey).not.toBe(secondCall.dedupeKey);
  });

  it('never calls governanceIssues.updateById — read-only on GovernanceIssue by design (ADR-0016 §16.1)', async () => {
    governanceIssues.findMany.mockResolvedValue([issue()]);
    documents.findMany.mockResolvedValue([{ id: 'doc-1', currentHealthScoreId: 'score-current' }]);
    healthIssues.findMany.mockResolvedValue([]);

    await service.reconcileForOrganization('org-1');

    expect(governanceIssues.updateById).not.toHaveBeenCalled();
  });

  // Scale-hardening: bounded, cursor-paginated reconciliation instead of a
  // single unbounded findMany() for the whole organization's open backlog.
  describe('batching (scale-hardening)', () => {
    // documents/healthIssues respond generically to whatever ids a given
    // batch requests, so each test only needs to shape governanceIssues —
    // currentHealthScoreId: null makes every issue a stillDetected: false
    // candidate (the "no currentHealthScoreId" rule, already covered
    // above), keeping the candidate-count math simple across batches.
    //
    // jest.clearAllMocks() (outer beforeEach) resets call history but does
    // NOT clear a mock's queued mockResolvedValueOnce values — a test that
    // queues more once-values than the loop actually consumes (e.g. the
    // trailing [] "just in case" terminator, unneeded when a page comes
    // back under RECONCILIATION_BATCH_SIZE and short-circuits) leaves a
    // stale queued value that would otherwise leak into the NEXT test's
    // first call. mockReset() here guarantees each test starts with a
    // fully empty queue, not just empty call history.
    beforeEach(() => {
      governanceIssues.findMany.mockReset();
      documents.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, currentHealthScoreId: null })),
      );
    });

    it('paginates via a cursor on id (ascending, strictly-greater-than), not skip/take', async () => {
      const firstBatch = Array.from({ length: RECONCILIATION_BATCH_SIZE }, (_, i) =>
        issue({ id: `issue-${i}`, documentId: `doc-${i}` }),
      );
      governanceIssues.findMany.mockResolvedValueOnce(firstBatch).mockResolvedValueOnce([]);

      await service.reconcileForOrganization('org-1');

      expect(governanceIssues.findMany).toHaveBeenNthCalledWith(1, {
        where: { status: { in: ['Open', 'InProgress'] } },
        orderBy: { id: 'asc' },
        take: RECONCILIATION_BATCH_SIZE,
      });
      expect(governanceIssues.findMany).toHaveBeenNthCalledWith(2, {
        where: { status: { in: ['Open', 'InProgress'] }, id: { gt: `issue-${RECONCILIATION_BATCH_SIZE - 1}` } },
        orderBy: { id: 'asc' },
        take: RECONCILIATION_BATCH_SIZE,
      });
    });

    it('processes every issue across multiple pages — no issue is skipped between batches', async () => {
      const firstBatch = Array.from({ length: RECONCILIATION_BATCH_SIZE }, (_, i) =>
        issue({ id: `issue-${i}`, documentId: `doc-${i}` }),
      );
      const secondBatch = [issue({ id: `issue-${RECONCILIATION_BATCH_SIZE}`, documentId: 'doc-last' })];
      governanceIssues.findMany.mockResolvedValueOnce(firstBatch).mockResolvedValueOnce(secondBatch);

      await service.reconcileForOrganization('org-1');

      // One candidate per issue across both pages — none skipped, none duplicated.
      expect(notifications.upsertByDedupeKey).toHaveBeenCalledTimes(RECONCILIATION_BATCH_SIZE + 1);
      // Full page (forces a next fetch) + a second page under batch size
      // (short-circuits, no further empty-page round-trip needed).
      expect(governanceIssues.findMany).toHaveBeenCalledTimes(2);
    });

    it('never processes the same issue twice across batches — no duplication, even though the cursor overlaps no rows', async () => {
      // A page exactly at the size limit forces a second fetch (the
      // implementation cannot assume it was the last page) — this is the
      // one scenario that genuinely exercises two real batches.
      const firstBatch = Array.from({ length: RECONCILIATION_BATCH_SIZE }, (_, i) =>
        issue({ id: `issue-${i}`, documentId: `doc-${i}` }),
      );
      const secondBatch = [issue({ id: `issue-${RECONCILIATION_BATCH_SIZE}`, documentId: 'doc-last' })];
      governanceIssues.findMany.mockResolvedValueOnce(firstBatch).mockResolvedValueOnce(secondBatch);

      await service.reconcileForOrganization('org-1');

      const dedupeKeys = notifications.upsertByDedupeKey.mock.calls.map(
        ([args]: [{ dedupeKey: string }]) => args.dedupeKey,
      );
      expect(new Set(dedupeKeys).size).toBe(dedupeKeys.length); // every key unique — nothing processed twice
      expect(dedupeKeys).toHaveLength(RECONCILIATION_BATCH_SIZE + 1);
    });

    it('boundary: stops after a page exactly equal to batch size returns, without an extra unnecessary round-trip once the next page is confirmed empty', async () => {
      const fullBatch = Array.from({ length: RECONCILIATION_BATCH_SIZE }, (_, i) => issue({ id: `issue-${i}`, documentId: `doc-${i}` }));
      governanceIssues.findMany.mockResolvedValueOnce(fullBatch).mockResolvedValueOnce([]);

      await service.reconcileForOrganization('org-1');

      // A batch exactly at the size limit cannot be assumed to be the last
      // page — the implementation correctly fetches once more and only
      // stops once that next page comes back empty.
      expect(governanceIssues.findMany).toHaveBeenCalledTimes(2);
    });

    it('boundary: a single page under batch size stops after one fetch (no unnecessary empty-page round-trip)', async () => {
      governanceIssues.findMany.mockResolvedValueOnce([issue({ id: 'issue-1', documentId: 'doc-1' })]);

      await service.reconcileForOrganization('org-1');

      expect(governanceIssues.findMany).toHaveBeenCalledTimes(1);
    });

    it('repeated reconciliation across multiple pages remains idempotent — same dedupeKeys every run, safe to re-run', async () => {
      const fixedUpdatedAt = new Date('2026-07-01T00:00:00.000Z');
      const buildBatches = (): [Array<ReturnType<typeof issue>>, Array<ReturnType<typeof issue>>] => [
        Array.from({ length: RECONCILIATION_BATCH_SIZE }, (_, i) =>
          issue({ id: `issue-${i}`, documentId: `doc-${i}`, updatedAt: fixedUpdatedAt }),
        ),
        [issue({ id: `issue-${RECONCILIATION_BATCH_SIZE}`, documentId: 'doc-last', updatedAt: fixedUpdatedAt })],
      ];

      for (let run = 0; run < 2; run++) {
        const [firstBatch, secondBatch] = buildBatches();
        // Exactly 2 queued values per run — the second page (1 item, under
        // batch size) short-circuits without a 3rd confirming-empty fetch,
        // so a 3rd queued value would go unconsumed and leak into the next
        // run's first call.
        governanceIssues.findMany.mockResolvedValueOnce(firstBatch).mockResolvedValueOnce(secondBatch);
        await service.reconcileForOrganization('org-1');
      }

      const dedupeKeys = notifications.upsertByDedupeKey.mock.calls.map(
        ([args]: [{ dedupeKey: string }]) => args.dedupeKey,
      );
      // (BATCH_SIZE + 1) issues x 2 runs worth of calls, but only
      // (BATCH_SIZE + 1) distinct dedupeKeys — the database-level unique
      // constraint (not this service) is what actually collapses the
      // second run's calls to no-ops; this proves the service computes
      // the SAME key every time for the SAME issue generation, across
      // batch boundaries too, which is its share of that guarantee.
      expect(dedupeKeys).toHaveLength(2 * (RECONCILIATION_BATCH_SIZE + 1));
      expect(new Set(dedupeKeys).size).toBe(RECONCILIATION_BATCH_SIZE + 1);
    });
  });
});
