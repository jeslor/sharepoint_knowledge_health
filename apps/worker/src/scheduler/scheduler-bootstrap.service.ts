import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SCHEDULER_QUEUE } from '@sph/types';

const TICK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes — ADR-0015 §1
const HEARTBEAT_JOB_ID = 'scheduler-heartbeat';

/**
 * Registers the scheduler's repeatable BullMQ job once per worker boot.
 * Deliberately NOT `@nestjs/schedule`'s `@Cron()` — that fires once per
 * *process*, so N horizontally-scaled apps/worker replicas (ADR-0006,
 * KEDA-scaled) would each independently duplicate every tick. A BullMQ
 * repeatable job with a fixed jobId is idempotent at the Redis level:
 * every replica calling `.add()` with the same jobId + repeat options on
 * startup converges on one registration, and BullMQ's existing job-locking
 * (the same mechanism already used for SCAN_QUEUE) guarantees exactly one
 * replica processes each tick. This is what actually makes the scheduler
 * safe against duplicate execution under scale, not application logic.
 */
@Injectable()
export class SchedulerBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerBootstrapService.name);

  constructor(@InjectQueue(SCHEDULER_QUEUE) private readonly schedulerQueue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.schedulerQueue.add(
      'tick',
      {},
      {
        repeat: { every: TICK_INTERVAL_MS },
        jobId: HEARTBEAT_JOB_ID,
      },
    );
    this.logger.log(`Scheduler heartbeat registered (every ${TICK_INTERVAL_MS / 60_000} minutes)`);
  }
}
