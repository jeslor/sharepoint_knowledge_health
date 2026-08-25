import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { REMEDIATION_QUEUE } from '@sph/types';
import { RemediationProcessor } from './remediation.processor';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    // For the already-registered NOTIFICATION_RECONCILIATION_QUEUE —
    // RemediationProcessor is only ever a producer onto it (ADR-0022
    // §3.6/§10, mirroring DocumentCollectorProcessor's own event-driven
    // trigger exactly), never a second reconciliation execution path.
    // Matches QueueModule's identical import of NotificationsModule for
    // the same reason.
    NotificationsModule,
    BullModule.registerQueue({
      name: REMEDIATION_QUEUE,
      // Matches SCAN_QUEUE/DISCOVERY_QUEUE/NOTIFICATION_RECONCILIATION_QUEUE's
      // registration exactly (ADR-0022 §3.3: "following SCAN_QUEUE's
      // existing shape"). Non-repeatable — jobs are produced on-demand by
      // the API layer (Phase 6), not on a schedule.
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    }),
  ],
  providers: [RemediationProcessor],
  exports: [BullModule],
})
export class RemediationModule {}
