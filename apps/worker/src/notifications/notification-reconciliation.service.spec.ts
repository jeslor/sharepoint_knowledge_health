import { createTenantContext } from '@sph/database';
import { NotificationReconciliationService } from './notification-reconciliation.service';

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

    expect(governanceIssues.findMany).toHaveBeenCalledWith({ where: { status: { in: ['Open', 'InProgress'] } } });
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
});
