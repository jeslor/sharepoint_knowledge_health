import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { DISCOVERY_QUEUE, type DiscoveryJobPayload } from '@sph/types';
import { createTenantContext, type TenantContext } from '@sph/database';
import { listSites } from '@sph/graph-client';

/**
 * ADR-0014 amendment (2026-07-20): discovery execution moved here from
 * apps/api — the worker owns the full lifecycle (Queued → Running →
 * Completed/Failed) for exactly the same reliability reason SCAN_QUEUE's
 * pipeline is queue-driven (ADR-0004, ADR-0015 §1): decoupled from any
 * single HTTP request's lifecycle. This is Phase 1a only — nothing in
 * apps/api produces onto DISCOVERY_QUEUE yet (Phase 1b); this processor is
 * fully self-contained and independently testable in the meantime.
 */
@Processor(DISCOVERY_QUEUE, { concurrency: 5 })
export class SiteDiscoveryProcessor extends WorkerHost {
  private readonly logger = new Logger(SiteDiscoveryProcessor.name);

  /**
   * BullMQ retries the job itself (see defaultJobOptions on the queue,
   * attempts: 3 + exponential backoff — ADR-0014 amendment's Failure
   * handling section). This fires on *every* failed attempt, not just the
   * last one, so discoveryStatus is only written to Failed once
   * job.attemptsMade reaches the configured max — matching the ADR's
   * "only once BullMQ's own retries are exhausted" requirement exactly.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<DiscoveryJobPayload> | undefined, error: Error): Promise<void> {
    if (!job) return;

    const maxAttempts = job.opts.attempts ?? 1;
    this.logger.error(
      `Discovery job ${job.id} (org=${job.data.organizationId}, tenant=${job.data.microsoftTenantId}) failed ` +
        `(attempt ${job.attemptsMade}/${maxAttempts}): ${error.message}`,
      error.stack,
    );

    if (job.attemptsMade < maxAttempts) return; // more retries pending — not a terminal failure yet

    const context = createTenantContext(job.data.organizationId);
    // Not a full stack trace — matches ScanJob.errorSummary's existing
    // convention and security.md's "never log sensitive data" (a Graph
    // error message can occasionally echo request details).
    await context.microsoftTenants.updateById(job.data.microsoftTenantId, {
      discoveryStatus: 'Failed',
      discoveryCompletedAt: new Date(),
      discoveryError: error.message,
    });
  }

  async process(job: Job<DiscoveryJobPayload>): Promise<void> {
    const { organizationId, microsoftTenantId } = job.data;
    const context = createTenantContext(organizationId);

    const tenant = await context.microsoftTenants.findFirstById(microsoftTenantId);
    if (!tenant) {
      this.logger.warn(`MicrosoftTenant ${microsoftTenantId} not found for organization ${organizationId}, skipping`);
      return;
    }

    await context.microsoftTenants.updateById(microsoftTenantId, {
      discoveryStatus: 'Running',
      discoveryStartedAt: new Date(),
    });

    // Deliberately uncaught: packages/graph-client's own RetryHandler
    // already absorbs transient Graph failures (ADR-0013 §3) before this
    // ever throws, so a throw here represents a genuine failure (auth,
    // permission, or exhausted transient retries) — letting it propagate
    // triggers BullMQ's whole-job retry (safe: discoverSites is idempotent,
    // see below) and, once those are exhausted, onFailed above.
    const discoveredSitesCount = await this.discoverSites(context, tenant.entraTenantId, microsoftTenantId);

    await context.microsoftTenants.updateById(microsoftTenantId, {
      discoveryStatus: 'Completed',
      discoveryCompletedAt: new Date(),
      discoveryError: null,
    });

    this.logger.log(`Discovery completed for tenant ${microsoftTenantId}: ${discoveredSitesCount} site(s) known`);
  }

  /**
   * Idempotent by construction (ADR-0014 amendment): an already-known site
   * (matched by graphSiteId) is never re-created, and its status/
   * approvedAt/approvedByUserId are never written to — only siteUrl/
   * displayName are refreshed if Graph now reports something different.
   * This is the one place approval preservation across repeated discovery
   * runs is guaranteed, and it holds identically whether this is the
   * organization's first-ever discovery, a manual admin-triggered rescan,
   * or a failure-recovery retry — there is only one code path.
   */
  private async discoverSites(context: TenantContext, entraTenantId: string, microsoftTenantId: string): Promise<number> {
    const existingSites = await context.sharePointSites.findMany({ where: { microsoftTenantId } });
    const existingByGraphSiteId = new Map(existingSites.map((site) => [site.graphSiteId, site]));

    let count = 0;
    for await (const graphSite of listSites(entraTenantId, { correlationId: microsoftTenantId })) {
      const existing = existingByGraphSiteId.get(graphSite.id);

      if (existing) {
        if (existing.siteUrl !== graphSite.webUrl || existing.displayName !== graphSite.displayName) {
          await context.sharePointSites.updateById(existing.id, {
            siteUrl: graphSite.webUrl,
            displayName: graphSite.displayName,
          });
        }
        count += 1;
        continue;
      }

      await context.sharePointSites.create({
        microsoftTenantId,
        graphSiteId: graphSite.id,
        siteUrl: graphSite.webUrl,
        displayName: graphSite.displayName,
      });
      count += 1;
    }

    return count;
  }
}
