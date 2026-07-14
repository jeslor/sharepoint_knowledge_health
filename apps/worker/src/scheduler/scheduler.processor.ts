import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { SCAN_QUEUE, SCHEDULER_QUEUE, type ScanJobPayload } from '@sph/types';
import { createTenantContext, findDueScanSchedules, type ScanSchedule } from '@sph/database';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function intervalMs(frequency: string): number {
  return frequency === 'Weekly' ? MS_PER_DAY * 7 : MS_PER_DAY;
}

/**
 * Advances from the *previous* nextRunAt, not from `now` — keeps the
 * schedule's intended time-of-day stable over the long run instead of
 * drifting forward by however late this tick happened to run (ADR-0015
 * §1's ~15-minute tick granularity). The max(...) guards against a burst
 * of rapid catch-up scans if a schedule was disabled for a long time and
 * just got re-enabled — nextRunAt is never allowed to land in the past.
 */
function computeNextRunAt(previousNextRunAt: Date, frequency: string, now: Date): Date {
  const advanced = new Date(previousNextRunAt.getTime() + intervalMs(frequency));
  const floor = new Date(now.getTime() + intervalMs(frequency));
  return advanced > floor ? advanced : floor;
}

/**
 * The scheduler tick (ADR-0015 §1, Phase 7B). Fired by a BullMQ repeatable
 * job (registered once by SchedulerBootstrapService) — this is only ever
 * a heartbeat, never the schedule registry. Postgres (ScanSchedule) is the
 * sole source of truth for what's due; this processor's whole job is to
 * turn "due schedules" into real ScanJobs through the *exact same*
 * creation-and-enqueue path apps/api's ScansService.triggerScan already
 * uses (create the row, enqueue { organizationId, scanJobId } onto
 * SCAN_QUEUE) — scheduling is only ever another producer, never a second
 * scan execution path. DocumentCollectorProcessor is completely untouched.
 */
@Processor(SCHEDULER_QUEUE, { concurrency: 1 })
export class SchedulerProcessor extends WorkerHost {
  private readonly logger = new Logger(SchedulerProcessor.name);

  constructor(@InjectQueue(SCAN_QUEUE) private readonly scanQueue: Queue<ScanJobPayload>) {
    super();
  }

  async process(): Promise<void> {
    const now = new Date();
    const dueSchedules = await findDueScanSchedules(now);

    this.logger.log(`Scheduler tick: ${dueSchedules.length} due schedule(s) found`);

    for (const schedule of dueSchedules) {
      try {
        await this.runSchedule(schedule, now);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to process ScanSchedule ${schedule.id} (org ${schedule.organizationId}): ${message}`);
      }
    }
  }

  private async runSchedule(schedule: ScanSchedule, now: Date): Promise<void> {
    const context = createTenantContext(schedule.organizationId);

    // Resolve the org's single Consented MicrosoftTenant — mirrors
    // apps/api's ScansService.triggerScanForOrganization exactly. Can't
    // import that service directly (ADR-0009: apps/worker never depends
    // on apps/api), so this small check is duplicated here, matching the
    // same precedent already set for scoreTenantDocuments's aggregate
    // calculation mirroring HealthSummaryService's in Phase 7A.
    const consentedTenants = await context.microsoftTenants.findMany({ where: { status: 'Consented' } });
    if (consentedTenants.length !== 1) {
      this.logger.warn(
        `Skipping ScanSchedule ${schedule.id} (org ${schedule.organizationId}): expected exactly 1 connected Microsoft tenant, found ${consentedTenants.length}`,
      );
      return; // Config problem, not transient — leave nextRunAt so an admin fixing this doesn't have to wait a full cycle.
    }
    const [tenant] = consentedTenants;
    if (!tenant) return;

    // Same concurrency guard manual triggers already rely on
    // (ScansService.triggerScan) — this is what makes the scheduler safe
    // against duplicate execution, not new logic of its own.
    const inFlight = await context.scanJobs.findMany({
      where: { microsoftTenantId: tenant.id, status: { in: ['Queued', 'Running'] } },
      take: 1,
    });
    if (inFlight.length > 0) {
      this.logger.log(`Skipping ScanSchedule ${schedule.id}: a scan is already in progress for this tenant`);
      return; // Leave nextRunAt/lastRunAt untouched — the next tick retries.
    }

    const scanJob = await context.scanJobs.create({
      microsoftTenantId: tenant.id,
      status: 'Queued',
      triggerSource: 'Scheduled',
      // triggeredByUserId omitted — nullable, no human triggered this.
    });

    await this.scanQueue.add('scan', { organizationId: schedule.organizationId, scanJobId: scanJob.id });

    await context.scanSchedules.updateById(schedule.id, {
      lastRunAt: now,
      nextRunAt: computeNextRunAt(schedule.nextRunAt, schedule.frequency, now),
    });

    this.logger.log(`ScanSchedule ${schedule.id} (org ${schedule.organizationId}) triggered ScanJob ${scanJob.id}`);
  }
}
