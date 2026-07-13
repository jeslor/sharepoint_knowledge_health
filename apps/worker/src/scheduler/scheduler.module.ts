import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SCHEDULER_QUEUE } from '@sph/types';
import { QueueModule } from '../queue/queue.module';
import { SchedulerProcessor } from './scheduler.processor';
import { SchedulerBootstrapService } from './scheduler-bootstrap.service';

@Module({
  imports: [
    // For the already-registered SCAN_QUEUE — the scheduler only ever
    // produces onto the same queue manual triggers use, never a queue of
    // its own for the actual scan work.
    QueueModule,
    BullModule.registerQueue({
      name: SCHEDULER_QUEUE,
      // Phase 9: previously unconfigured, meaning (a) a transient failure
      // in an entire tick — e.g. a DB blip during findDueScanSchedules —
      // had no retry at all (BullMQ's default is attempts: 1), silently
      // skipping that 15-minute cycle, and (b) every tick's job record
      // accumulated in Redis forever (worse here than the other two
      // queues: a fixed 15-minute cadence is ~35,000 completed jobs/year
      // with no bound). Retention is tighter than the scan queues' since
      // this queue only ever runs one kind of job at high frequency —
      // 100 completed jobs is still >24 hours of history.
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    }),
  ],
  providers: [SchedulerProcessor, SchedulerBootstrapService],
})
export class SchedulerModule {}
