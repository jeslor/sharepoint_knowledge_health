import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { NOTIFICATION_RECONCILIATION_QUEUE, REMEDIATION_QUEUE, type RemediationJobPayload } from '@sph/types';
import { createTenantContext, type RemediationItem, type RemediationJob, type TenantContext } from '@sph/database';
import { GraphClientError, GraphNotFoundError, GraphPermissionError, GraphThrottledError, GraphTransientError } from '@sph/graph-client';
import { executeSetReviewDateAction, type SetReviewDateActionPayload } from './set-review-date.action';
import { runWithConcurrencyLimit } from './concurrency-limiter';

// ADR-0022 §3.3: a dedicated env var, deliberately not shared with
// WORKER_CONCURRENCY (which governs how many *jobs* this processor's own
// @Processor runs in parallel, unchanged from every other queue's
// convention) — this one bounds how many *items within one job* run at
// once, a genuinely new concurrency axis. Default of 3, conservative
// relative to reads' default of 5, matching this feature's own
// higher-stakes framing (ADR-0022 §10: "write-path bugs are categorically
// higher-stakes than anything else built in this feature's history").
function remediationItemConcurrency(): number {
  return Number(process.env.REMEDIATION_WORKER_CONCURRENCY) || 3;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/**
 * ADR-0022 §3.3/§9/Phase 4: the bulk-remediation execution path. Postgres —
 * not this queue, not BullMQ's delivery count, not any in-memory counter —
 * is the sole source of truth for what work remains. Every invocation
 * (a fresh delivery, a BullMQ retry after a failure, or a redelivered
 * "stalled" job) reloads current RemediationItem state fresh and only
 * acts on rows still `Pending`; already-`Succeeded`/`Failed`/`Skipped`
 * rows are never re-touched.
 *
 * Governance resolution (ADR-0022 §13.2) is deliberately NOT implemented
 * here — it requires rescoring the document (§3.4, "reusing calculateScore's
 * existing per-document call shape"), which is real, separately-scoped
 * work this phase's own primary goal (item orchestration only) does not
 * cover. A Succeeded item here ends at that status; closing the loop to
 * GovernanceIssue.Resolved is an explicit follow-up, not silently dropped
 * or silently folded in.
 */
@Processor(REMEDIATION_QUEUE, { concurrency: Number(process.env.WORKER_CONCURRENCY) || 5 })
export class RemediationProcessor extends WorkerHost {
  private readonly logger = new Logger(RemediationProcessor.name);

  constructor(@InjectQueue(NOTIFICATION_RECONCILIATION_QUEUE) private readonly reconciliationQueue: Queue) {
    super();
  }

  async process(job: Job<RemediationJobPayload>): Promise<void> {
    const { organizationId, remediationJobId } = job.data;
    const context = createTenantContext(organizationId);

    const remediationJob = await context.remediationJobs.findFirstById(remediationJobId);
    if (!remediationJob) {
      this.logger.warn(`RemediationJob ${remediationJobId} not found for organization ${organizationId} — nothing to process.`);
      return;
    }

    // Already finished by a prior attempt or a duplicate/stalled-job
    // redelivery — a clean, idempotent no-op, not an error.
    if (remediationJob.status === 'Completed') {
      this.logger.log(`RemediationJob ${remediationJobId} is already Completed — skipping (duplicate delivery).`);
      return;
    }

    const payload = this.parseActionPayload(remediationJob);
    const entraTenantId = await this.resolveEntraTenantId(context);

    const pendingItems = await context.remediationItems.findMany({
      where: { remediationJobId, status: 'Pending' },
    });

    await runWithConcurrencyLimit(pendingItems, remediationItemConcurrency(), async (item) => {
      await this.processItem(context, entraTenantId, item, payload);
    });

    await this.finalizeIfComplete(context, remediationJobId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<RemediationJobPayload> | undefined, error: Error): void {
    this.logger.error(
      `RemediationJob ${job?.data.remediationJobId ?? 'unknown'} (org=${job?.data.organizationId ?? 'unknown'}) failed: ${error.message}`,
      error.stack,
    );
  }

  private parseActionPayload(remediationJob: RemediationJob): SetReviewDateActionPayload {
    const raw = remediationJob.payload as Record<string, unknown> | null;
    const nextReviewDueAt = raw?.nextReviewDueAt;
    if (typeof nextReviewDueAt !== 'string') {
      // A malformed job-level payload is not any one item's problem — let
      // it propagate and fail the whole process() call (matching how an
      // infrastructure-level issue is handled below), not something a
      // per-item retry could ever fix.
      throw new Error(`RemediationJob ${remediationJob.id} has a malformed payload — missing string nextReviewDueAt`);
    }
    return { nextReviewDueAt };
  }

  private async resolveEntraTenantId(context: TenantContext): Promise<string> {
    const [tenant] = await context.microsoftTenants.findMany({ where: { status: 'Consented' }, take: 1 });
    if (!tenant) {
      throw new Error(`No Consented MicrosoftTenant found for organization ${context.organizationId}`);
    }
    return tenant.entraTenantId;
  }

  /**
   * Loads the target Document and delegates entirely to
   * executeSetReviewDateAction (Phase 3) — this method never re-implements
   * drive resolution, review-date mapping resolution, the Graph PATCH, or
   * verification; it only interprets the action's result/errors and
   * persists the corresponding RemediationItem state (ADR-0022 §13.3).
   */
  private async processItem(
    context: TenantContext,
    entraTenantId: string,
    item: RemediationItem,
    payload: SetReviewDateActionPayload,
  ): Promise<void> {
    const document = await context.documents.findFirstById(item.documentId);
    if (!document) {
      // The document no longer exists — a real precondition failure, not
      // a Graph rejection. ADR-0022's own RemediationItemStatus doc
      // comment names exactly this case for Skipped ("e.g. the document
      // was deleted/moved before the job reached it").
      await context.remediationItems.updateById(item.id, {
        status: 'Skipped',
        errorType: 'DocumentNotFound',
        errorMessage: `Document ${item.documentId} no longer exists`,
        attemptCount: { increment: 1 },
      });
      return;
    }

    try {
      const result = await executeSetReviewDateAction({ entraTenantId, tenantContext: context }, document, payload);

      if (result.outcome === 'verified') {
        await context.remediationItems.updateById(item.id, { status: 'Succeeded', attemptCount: { increment: 1 } });
      } else {
        // Write succeeded, verification did not confirm it — ADR-0022
        // §13.3: stays Pending (retryable), never Failed, never Succeeded.
        await context.remediationItems.updateById(item.id, { attemptCount: { increment: 1 } });
      }
    } catch (error) {
      await this.handleItemError(context, item, error);
    }
  }

  /**
   * ADR-0022 §9's classification, applied here: permanent Graph errors
   * terminate the item; retryable Graph errors leave it Pending for the
   * next attempt; a non-Graph precondition Error from the action (no
   * graphListId/site/mapping/column) means this document was never
   * eligible, so it's Skipped, not Failed or Pending. Anything else —
   * most notably GraphAuthenticationError, and any genuinely unrecognized
   * error — is NOT absorbed as a per-item outcome: it propagates out of
   * process(), failing the whole job so BullMQ retries it, because an
   * infrastructure-level failure (broken credentials, a bug) would
   * otherwise be misclassified as "this one document is broken" and burn
   * through every remaining item with an identical, misleading failure.
   */
  private async handleItemError(context: TenantContext, item: RemediationItem, error: unknown): Promise<void> {
    if (error instanceof GraphPermissionError || error instanceof GraphNotFoundError) {
      await context.remediationItems.updateById(item.id, {
        status: 'Failed',
        errorType: error.constructor.name,
        errorMessage: errorMessage(error),
        attemptCount: { increment: 1 },
      });
      return;
    }

    if (error instanceof GraphThrottledError || error instanceof GraphTransientError) {
      await context.remediationItems.updateById(item.id, {
        errorType: error.constructor.name,
        errorMessage: errorMessage(error),
        attemptCount: { increment: 1 },
      });
      return;
    }

    if (error instanceof Error && !(error instanceof GraphClientError)) {
      await context.remediationItems.updateById(item.id, {
        status: 'Skipped',
        errorType: error.constructor.name,
        errorMessage: errorMessage(error),
        attemptCount: { increment: 1 },
      });
      return;
    }

    // GraphAuthenticationError (infrastructure/credential failure, never a
    // per-document classification per ADR-0022's own instruction) or any
    // other unrecognized error type — propagate untouched.
    this.logger.error(
      `Unrecoverable-at-item-level error processing RemediationItem ${item.id}: ${errorMessage(error)}`,
      errorStack(error),
    );
    throw error;
  }

  /**
   * Recomputes completion from a live count of RemediationItem rows —
   * never an incrementally-trusted running total — so this is safe to
   * call from more than one concurrent/duplicate invocation of the same
   * job. markCompletedIfRunning's own conditioned UPDATE (WHERE status =
   * 'Running') guarantees only one such invocation ever observes
   * `advanced: true`, which is what gates the one-time notification-
   * reconciliation enqueue (ADR-0022 §3.6/§10) — a duplicate/concurrent
   * finalize attempt finds the job already Completed and does nothing
   * further. This is the accepted, documented resolution to the narrow
   * duplicate-delivery race this codebase has no locking primitive for.
   */
  private async finalizeIfComplete(context: TenantContext, remediationJobId: string): Promise<void> {
    const stillPending = await context.remediationItems.count({ where: { remediationJobId, status: 'Pending' } });
    if (stillPending > 0) return;

    const [succeededCount, failedCount] = await Promise.all([
      context.remediationItems.count({ where: { remediationJobId, status: 'Succeeded' } }),
      context.remediationItems.count({ where: { remediationJobId, status: 'Failed' } }),
    ]);

    const { advanced } = await context.remediationJobs.markCompletedIfRunning(remediationJobId, {
      succeededCount,
      failedCount,
      completedAt: new Date(),
    });
    if (!advanced) return; // another invocation already completed this job

    try {
      await this.reconciliationQueue.add('reconcile-org', { organizationId: context.organizationId });
    } catch (error) {
      this.logger.error(`Failed to enqueue notification reconciliation for org ${context.organizationId}: ${errorMessage(error)}`);
    }
  }
}
