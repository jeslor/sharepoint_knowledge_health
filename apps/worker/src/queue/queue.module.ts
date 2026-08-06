import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SCAN_QUEUE } from '@sph/types';
import { DocumentCollectorProcessor } from './document-collector.processor';
import { StaleScanRecoveryService } from './stale-scan-recovery.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    // For the already-registered NOTIFICATION_RECONCILIATION_QUEUE —
    // DocumentCollectorProcessor is only ever a producer onto it (ADR-0021
    // §3.3's event-driven trigger), never a second reconciliation
    // execution path; NotificationsModule owns the actual consumer
    // (NotificationReconciliationProcessor). Mirrors exactly how
    // SchedulerModule imports this same QueueModule to produce onto
    // SCAN_QUEUE without re-registering it.
    NotificationsModule,
    BullModule.registerQueue({
      name: SCAN_QUEUE,
      // Phase 7B: the scheduler (apps/worker/src/scheduler) becomes a
      // second producer onto this same queue. Matching apps/api's
      // registerQueue config exactly (scans.module.ts) so a
      // scheduler-produced job gets identical retry behavior to an
      // API-produced one — whole-job retry is safe for the same reason
      // documented there (idempotent document upsert, full-recompute
      // scoring).
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        // Phase 9: matches apps/api's scans.module.ts registration exactly
        // — see that comment for why this is a required, not optional, fix.
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    }),
  ],
  providers: [DocumentCollectorProcessor, StaleScanRecoveryService],
  exports: [BullModule],
})
export class QueueModule {}
