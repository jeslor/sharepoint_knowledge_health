import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createTenantContext, type ScanJob } from '@sph/database';
import { SCAN_QUEUE, type ScanJobPayload, type ScanResponse } from '@sph/types';

const MOST_RECENT_SCANS_LIMIT = 50;

function toScanResponse(scanJob: ScanJob): ScanResponse {
  return {
    id: scanJob.id,
    microsoftTenantId: scanJob.microsoftTenantId,
    triggeredByUserId: scanJob.triggeredByUserId,
    status: scanJob.status,
    startedAt: scanJob.startedAt?.toISOString() ?? null,
    completedAt: scanJob.completedAt?.toISOString() ?? null,
    documentsScanned: scanJob.documentsScanned,
    documentsFailed: scanJob.documentsFailed,
    errorSummary: scanJob.errorSummary,
    createdAt: scanJob.createdAt.toISOString(),
  };
}

/**
 * Scan trigger/status (ADR-0004): "POST /scans enqueues, returns a job id;
 * GET /scans/:id returns status/progress." Enqueueing only ever hands off
 * a { organizationId, scanJobId } payload — the Document Collector
 * (apps/worker) resolves everything else itself from that job id.
 */
@Injectable()
export class ScansService {
  constructor(@InjectQueue(SCAN_QUEUE) private readonly scanQueue: Queue<ScanJobPayload>) {}

  async triggerScan(organizationId: string, microsoftTenantId: string, triggeredByUserId: string): Promise<ScanJob> {
    const context = createTenantContext(organizationId);

    const microsoftTenant = await context.microsoftTenants.findFirstById(microsoftTenantId);
    if (!microsoftTenant) {
      throw new NotFoundException('Microsoft tenant not found');
    }

    // Two concurrent collections of the same tenant would race on the same
    // Document rows (find-then-write, not an atomic upsert) — block a new
    // trigger while one is already in flight rather than relying on timing.
    const inFlight = await context.scanJobs.findMany({
      where: { microsoftTenantId, status: { in: ['Queued', 'Running'] } },
      take: 1,
    });
    if (inFlight.length > 0) {
      throw new ConflictException('A scan is already in progress for this Microsoft tenant');
    }

    const scanJob = await context.scanJobs.create({
      microsoftTenantId,
      triggeredByUserId,
      status: 'Queued',
    });

    await this.scanQueue.add('scan', { organizationId, scanJobId: scanJob.id });

    return scanJob;
  }

  /**
   * Convenience entry point for the dashboard's "Start Scan" button — the
   * common case is one connected Microsoft tenant per organization
   * (ADR-0012's self-service onboarding flow). Delegates to triggerScan
   * (same concurrency guard, same everything) once the tenant is resolved;
   * this method adds no new business logic of its own.
   */
  async triggerScanForOrganization(
    organizationId: string,
    triggeredByUserId: string,
    microsoftTenantId?: string,
  ): Promise<ScanJob> {
    if (microsoftTenantId) {
      return this.triggerScan(organizationId, microsoftTenantId, triggeredByUserId);
    }

    const context = createTenantContext(organizationId);
    const consentedTenants = await context.microsoftTenants.findMany({ where: { status: 'Consented' } });

    if (consentedTenants.length === 0) {
      throw new NotFoundException('No connected Microsoft tenant for this organization');
    }
    if (consentedTenants.length > 1) {
      throw new ConflictException(
        'Organization has more than one connected Microsoft tenant; specify microsoftTenantId',
      );
    }

    const [onlyTenant] = consentedTenants;
    if (!onlyTenant) {
      throw new NotFoundException('No connected Microsoft tenant for this organization');
    }
    return this.triggerScan(organizationId, onlyTenant.id, triggeredByUserId);
  }

  async getScan(organizationId: string, scanJobId: string): Promise<ScanJob> {
    const context = createTenantContext(organizationId);
    const scanJob = await context.scanJobs.findFirstById(scanJobId);
    if (!scanJob) throw new NotFoundException('Scan job not found');
    return scanJob;
  }

  async listScans(organizationId: string): Promise<ScanResponse[]> {
    const context = createTenantContext(organizationId);
    const scanJobs = await context.scanJobs.findMany({
      orderBy: { createdAt: 'desc' },
      take: MOST_RECENT_SCANS_LIMIT,
    });
    return scanJobs.map(toScanResponse);
  }
}
