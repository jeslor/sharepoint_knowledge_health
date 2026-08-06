import type { Job } from 'bullmq';
import type { NotificationReconciliationJobPayload } from '@sph/types';
import { NotificationReconciliationProcessor } from './notification-reconciliation.processor';
import { NotificationReconciliationService } from './notification-reconciliation.service';

jest.mock('./notification-reconciliation.service');

function job(payload: NotificationReconciliationJobPayload): Job<NotificationReconciliationJobPayload> {
  return { id: 'job-1', data: payload } as Job<NotificationReconciliationJobPayload>;
}

describe('NotificationReconciliationProcessor', () => {
  const reconciliationService = new NotificationReconciliationService() as jest.Mocked<NotificationReconciliationService>;
  const processor = new NotificationReconciliationProcessor(reconciliationService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to reconcileForOrganization with the job payload organizationId', async () => {
    await processor.process(job({ organizationId: 'org-1' }));

    expect(reconciliationService.reconcileForOrganization).toHaveBeenCalledWith('org-1');
  });

  it('logs a terminal job failure via the failed event', () => {
    const logSpy = jest.spyOn((processor as unknown as { logger: { error: jest.Mock } }).logger, 'error');

    processor.onFailed(job({ organizationId: 'org-1' }), new Error('boom'));

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('org-1'), expect.anything());
  });
});
