import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NOTIFICATION_RECONCILIATION_QUEUE, NOTIFICATION_RECONCILIATION_SWEEP_QUEUE } from '@sph/types';
import { NotificationReconciliationService } from './notification-reconciliation.service';
import { NotificationReconciliationProcessor } from './notification-reconciliation.processor';
import { NotificationReconciliationSweepProcessor } from './notification-reconciliation-sweep.processor';
import { NotificationReconciliationSweepBootstrapService } from './notification-reconciliation-sweep-bootstrap.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: NOTIFICATION_RECONCILIATION_QUEUE,
      // Matches SCAN_QUEUE/DISCOVERY_QUEUE's registration exactly — whole-
      // job retry is safe (reconciliation is idempotent: re-running it for
      // the same org just re-derives the same stillDetected answers and
      // the dedup check prevents duplicate notifications either way).
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    }),
    BullModule.registerQueue({
      name: NOTIFICATION_RECONCILIATION_SWEEP_QUEUE,
      // Matches SCHEDULER_QUEUE's registration exactly — same rationale
      // (a transient failure in a whole tick gets retried; job history
      // stays bounded). Tighter retention than the per-org queue since
      // this one only ever runs one kind of job, hourly.
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    }),
  ],
  providers: [
    NotificationReconciliationService,
    NotificationReconciliationProcessor,
    NotificationReconciliationSweepProcessor,
    NotificationReconciliationSweepBootstrapService,
  ],
  exports: [BullModule],
})
export class NotificationsModule {}
