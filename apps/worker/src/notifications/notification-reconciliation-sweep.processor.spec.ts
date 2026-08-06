import { findOrganizationIdsWithOpenGovernanceIssues } from '@sph/database';
import type { Queue } from 'bullmq';
import { NotificationReconciliationSweepProcessor } from './notification-reconciliation-sweep.processor';

jest.mock('@sph/database');

const mockedFindOrgs = findOrganizationIdsWithOpenGovernanceIssues as jest.MockedFunction<
  typeof findOrganizationIdsWithOpenGovernanceIssues
>;

describe('NotificationReconciliationSweepProcessor', () => {
  const reconciliationQueue = { add: jest.fn() };
  const processor = new NotificationReconciliationSweepProcessor(reconciliationQueue as unknown as Queue);

  beforeEach(() => {
    jest.clearAllMocks();
    reconciliationQueue.add.mockResolvedValue(undefined);
  });

  it('does nothing when no organizations have open governance work', async () => {
    mockedFindOrgs.mockResolvedValue([]);

    await processor.process();

    expect(reconciliationQueue.add).not.toHaveBeenCalled();
  });

  it('enqueues a reconciliation job onto NOTIFICATION_RECONCILIATION_QUEUE for every affected organization', async () => {
    mockedFindOrgs.mockResolvedValue(['org-1', 'org-2']);

    await processor.process();

    expect(reconciliationQueue.add).toHaveBeenCalledWith('reconcile-org', { organizationId: 'org-1' });
    expect(reconciliationQueue.add).toHaveBeenCalledWith('reconcile-org', { organizationId: 'org-2' });
  });

  it('isolates one organization enqueue failure so the rest of the sweep still completes', async () => {
    mockedFindOrgs.mockResolvedValue(['org-bad', 'org-good']);
    reconciliationQueue.add.mockImplementation(async (_name: string, data: { organizationId: string }) => {
      if (data.organizationId === 'org-bad') throw new Error('Redis unavailable');
    });

    await processor.process();

    expect(reconciliationQueue.add).toHaveBeenCalledWith('reconcile-org', { organizationId: 'org-good' });
  });
});
