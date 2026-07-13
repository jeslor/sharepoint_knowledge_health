import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SCAN_QUEUE } from '@sph/types';
import { DocumentCollectorProcessor } from './document-collector.processor';

@Module({
  imports: [
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
      },
    }),
  ],
  providers: [DocumentCollectorProcessor],
  exports: [BullModule],
})
export class QueueModule {}
