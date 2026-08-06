import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  NOTIFICATION_RECONCILIATION_QUEUE,
  NOTIFICATION_RECONCILIATION_SWEEP_QUEUE,
  type NotificationReconciliationJobPayload,
} from '@sph/types';
import { findOrganizationIdsWithOpenGovernanceIssues } from '@sph/database';

/**
 * ADR-0021 §3.3: the periodic safety-net tick. Fired by a BullMQ
 * repeatable job (registered once by
 * NotificationReconciliationSweepBootstrapService) — this is only ever a
 * heartbeat that discovers which organizations need a check, never a
 * second reconciliation execution path of its own. Every organization it
 * finds is enqueued onto NOTIFICATION_RECONCILIATION_QUEUE — the *exact
 * same* per-org job the event-driven trigger produces — so
 * NotificationReconciliationProcessor remains the single place
 * reconciliation actually happens, matching SchedulerProcessor's own
 * "turn due schedules into real ScanJobs through the exact same path" shape.
 */
@Processor(NOTIFICATION_RECONCILIATION_SWEEP_QUEUE, { concurrency: 1 })
export class NotificationReconciliationSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationReconciliationSweepProcessor.name);

  constructor(
    @InjectQueue(NOTIFICATION_RECONCILIATION_QUEUE)
    private readonly reconciliationQueue: Queue<NotificationReconciliationJobPayload>,
  ) {
    super();
  }

  async process(): Promise<void> {
    const organizationIds = await findOrganizationIdsWithOpenGovernanceIssues();
    this.logger.log(`Reconciliation safety-net sweep: ${organizationIds.length} organization(s) with open governance work found`);

    for (const organizationId of organizationIds) {
      try {
        await this.reconciliationQueue.add('reconcile-org', { organizationId });
      } catch (error) {
        // One organization's enqueue failure must not abort the rest of
        // the sweep — matches SchedulerProcessor's own per-schedule
        // try/catch isolation.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to enqueue reconciliation for org ${organizationId} during sweep: ${message}`);
      }
    }
  }
}
