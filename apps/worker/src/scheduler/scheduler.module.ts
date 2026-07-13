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
    BullModule.registerQueue({ name: SCHEDULER_QUEUE }),
  ],
  providers: [SchedulerProcessor, SchedulerBootstrapService],
})
export class SchedulerModule {}
