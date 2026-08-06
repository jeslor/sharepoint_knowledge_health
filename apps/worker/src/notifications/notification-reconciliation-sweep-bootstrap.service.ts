import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NOTIFICATION_RECONCILIATION_SWEEP_QUEUE } from '@sph/types';

// ADR-0021 §3.3: deliberately low-frequency — this is a safety net for a
// missed/failed event-driven enqueue, not the primary trigger (the scan
// completion hook is). Hourly, not SchedulerBootstrapService's 15 minutes:
// reconciliation isn't time-critical the way scheduled-scan triggering is,
// and most organizations won't scan more than a few times a day, so a
// tighter interval would mostly re-check organizations with nothing new
// to find.
const TICK_INTERVAL_MS = 60 * 60 * 1000;
const HEARTBEAT_JOB_ID = 'notification-reconciliation-sweep-heartbeat';

/**
 * Registers the sweep's repeatable BullMQ job once per worker boot — same
 * idempotent-at-the-Redis-level pattern as SchedulerBootstrapService
 * (fixed jobId + repeat options converge across replicas; BullMQ's
 * existing per-job locking guarantees exactly one replica processes each
 * tick), not `@nestjs/schedule`'s `@Cron()`, for the identical reason
 * documented there.
 */
@Injectable()
export class NotificationReconciliationSweepBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(NotificationReconciliationSweepBootstrapService.name);

  constructor(@InjectQueue(NOTIFICATION_RECONCILIATION_SWEEP_QUEUE) private readonly sweepQueue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.sweepQueue.add(
      'sweep',
      {},
      {
        repeat: { every: TICK_INTERVAL_MS },
        jobId: HEARTBEAT_JOB_ID,
      },
    );
    this.logger.log(`Notification reconciliation safety-net sweep registered (every ${TICK_INTERVAL_MS / 60_000} minutes)`);
  }
}
