import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { NOTIFICATION_RECONCILIATION_QUEUE, type NotificationReconciliationJobPayload } from '@sph/types';
import { NotificationReconciliationService } from './notification-reconciliation.service';

/**
 * ADR-0021 §3.3: consumes per-organization reconciliation jobs from either
 * producer (event-driven, DocumentCollectorProcessor; or the periodic
 * safety-net sweep, NotificationReconciliationSweepProcessor) — a single
 * execution path regardless of trigger, matching SCAN_QUEUE's own
 * "scheduling is a producer, never a second execution path" discipline.
 * Deliberately its own processor, never folded into
 * DocumentCollectorProcessor — an unrelated concern, and this codebase's
 * consistent "one execution path per concern" discipline (worker computes
 * scores / api serves governance / this: notification reconciliation).
 */
@Processor(NOTIFICATION_RECONCILIATION_QUEUE, { concurrency: Number(process.env.WORKER_CONCURRENCY) || 5 })
export class NotificationReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationReconciliationProcessor.name);

  constructor(private readonly reconciliationService: NotificationReconciliationService) {
    super();
  }

  async process(job: Job<NotificationReconciliationJobPayload>): Promise<void> {
    const { organizationId } = job.data;
    await this.reconciliationService.reconcileForOrganization(organizationId);
  }

  // Matches DocumentCollectorProcessor's own onFailed hook exactly — the
  // queue's own attempts:3/backoff (registered alongside this queue)
  // handles retry; this only makes an exhausted-retry failure observable
  // in logs instead of leaving no trace beyond Redis's internal state.
  @OnWorkerEvent('failed')
  onFailed(job: Job<NotificationReconciliationJobPayload> | undefined, error: Error): void {
    this.logger.error(
      `Reconciliation job ${job?.id ?? 'unknown'} (org=${job?.data.organizationId ?? 'unknown'}) failed: ${error.message}`,
      error.stack,
    );
  }
}
