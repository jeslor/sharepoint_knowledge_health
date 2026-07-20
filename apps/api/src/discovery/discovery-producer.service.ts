import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createTenantContext, discoveryJobId, shouldEnqueueDiscovery, type MicrosoftTenant } from '@sph/database';
import { DISCOVERY_QUEUE, type DiscoveryJobPayload } from '@sph/types';
import { withTimeout } from '../common/with-timeout';

// Matches SCAN_ENQUEUE_TIMEOUT_MS's own rationale exactly (scans.service.ts)
// — ioredis's maxRetriesPerRequest is a periodic, connection-wide flush, not
// a per-command bound, so this explicit timeout is what actually bounds
// queue.add() deterministically.
const DISCOVERY_ENQUEUE_TIMEOUT_MS = 10_000;

/**
 * ADR-0014 amendment: the single place any apps/api caller enqueues onto
 * DISCOVERY_QUEUE. Deliberately its own small, guard-free module (no
 * dependency on AuthModule or SharePointSitesModule) so both the
 * consent-callback bootstrap (AuthModule) and the manual discover-sites
 * endpoint (SharePointSitesModule) can depend on this one implementation
 * without creating a circular module dependency — SharePointSitesModule
 * already imports AuthModule for its guards, so AuthModule importing
 * SharePointSitesModule back would cycle; this module imports neither.
 *
 * discoveryStatus in Postgres is the sole concurrency authority (never
 * BullMQ's own job state) — the deterministic jobId below is a queue-level
 * dedup backstop only, not the guard itself.
 */
@Injectable()
export class DiscoveryProducerService {
  constructor(@InjectQueue(DISCOVERY_QUEUE) private readonly discoveryQueue: Queue<DiscoveryJobPayload>) {}

  async enqueueDiscovery(organizationId: string, microsoftTenantId: string): Promise<MicrosoftTenant> {
    const context = createTenantContext(organizationId);

    const tenant = await context.microsoftTenants.findFirstById(microsoftTenantId);
    if (!tenant) {
      throw new NotFoundException('Microsoft tenant not found');
    }

    if (!shouldEnqueueDiscovery(tenant)) {
      return tenant; // already Queued/Running — no-op safely, not an error
    }

    const queued = await context.microsoftTenants.updateById(microsoftTenantId, { discoveryStatus: 'Queued' });

    try {
      await withTimeout(
        this.discoveryQueue.add(
          'discover',
          { organizationId, microsoftTenantId },
          { jobId: discoveryJobId(microsoftTenantId) },
        ),
        DISCOVERY_ENQUEUE_TIMEOUT_MS,
        'Redis enqueue timed out',
      );
    } catch (enqueueError) {
      // Mirrors ScansService.triggerScan's compensating-write precedent
      // exactly: without this, a queue.add() failure leaves the tenant
      // permanently stuck at Queued — no worker will ever pick it up, and
      // the guard above then blocks every future discovery attempt
      // indefinitely.
      try {
        const message = enqueueError instanceof Error ? enqueueError.message : String(enqueueError);
        await context.microsoftTenants.updateById(microsoftTenantId, {
          discoveryStatus: 'Failed',
          discoveryCompletedAt: new Date(),
          discoveryError: `Failed to enqueue discovery: ${message}`,
        });
      } catch {
        // Compensating write itself failed — do not mask the original error.
      }
      throw enqueueError;
    }

    return queued ?? tenant;
  }
}
