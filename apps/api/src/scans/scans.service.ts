import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createTenantContext, type HealthIssue, type HealthScore, type ScanJob, type TenantContext } from '@sph/database';
import { SCAN_QUEUE, type ScanComparisonIssue, type ScanComparisonResponse, type ScanJobPayload, type ScanResponse } from '@sph/types';
import { withTimeout } from '../common/with-timeout';

const MOST_RECENT_SCANS_LIMIT = 50;

// F2 correction: ioredis's maxRetriesPerRequest is a periodic, connection-
// wide queue flush tied to a shared retry counter, not a per-command bound
// (confirmed by reading ioredis's source) — a real outage measured 15-38s
// depending on timing, not a small predictable number. This explicit
// timeout is what actually bounds queue.add() deterministically. Kept
// distinct from health.service.ts's REDIS_READINESS_TIMEOUT_MS (3000ms) —
// enqueue is a different operation with its own acceptable latency budget.
const SCAN_ENQUEUE_TIMEOUT_MS = 10_000;

function toScanResponse(scanJob: ScanJob): ScanResponse {
  return {
    id: scanJob.id,
    microsoftTenantId: scanJob.microsoftTenantId,
    triggeredByUserId: scanJob.triggeredByUserId,
    triggerSource: scanJob.triggerSource,
    status: scanJob.status,
    startedAt: scanJob.startedAt?.toISOString() ?? null,
    completedAt: scanJob.completedAt?.toISOString() ?? null,
    documentsScanned: scanJob.documentsScanned,
    documentsFailed: scanJob.documentsFailed,
    errorSummary: scanJob.errorSummary,
    createdAt: scanJob.createdAt.toISOString(),
    totalSites: scanJob.totalSites,
    sitesCompleted: scanJob.sitesCompleted,
    currentSiteName: scanJob.currentSiteName,
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

    try {
      await withTimeout(
        this.scanQueue.add('scan', { organizationId, scanJobId: scanJob.id }),
        SCAN_ENQUEUE_TIMEOUT_MS,
        'Redis enqueue timed out',
      );
    } catch (enqueueError) {
      // LAT F9: without this, a queue.add() failure (e.g. Redis unavailable)
      // leaves this ScanJob permanently stuck at 'Queued' — no worker will
      // ever pick it up, and triggerScan's own in-flight guard above then
      // blocks every future scan for this tenant indefinitely. Compensating
      // write, not a transaction (Postgres and Redis are separate systems) —
      // reuses the exact { status: 'Failed', completedAt, errorSummary }
      // shape recoverStaleScanJobs already established for the same class
      // of problem (packages/database/src/scan-recovery.ts).
      try {
        const message = enqueueError instanceof Error ? enqueueError.message : String(enqueueError);
        await context.scanJobs.updateById(scanJob.id, {
          status: 'Failed',
          completedAt: new Date(),
          errorSummary: `Failed to enqueue scan job: ${message}`,
        });
      } catch {
        // Compensating write itself failed (e.g. Postgres also down) — do
        // not mask the original enqueue error with this one.
      }
      throw enqueueError;
    }

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

  /**
   * Recommendation #5 (historical comparisons): highlight what changed
   * between this scan and the one immediately before it. Reads only
   * already-persisted rows (HealthSnapshot for the aggregate deltas,
   * HealthScore/HealthIssue for the per-document diff) — no recalculation,
   * no new scoring. Returns an all-null/empty shape rather than 404 when
   * there's nothing to compare yet (this scan hasn't completed, or it's
   * the organization's first scan), matching health-summary's
   * null-friendly convention elsewhere in this API.
   */
  async getScanComparison(organizationId: string, scanId: string): Promise<ScanComparisonResponse> {
    const context = createTenantContext(organizationId);

    const scanJob = await context.scanJobs.findFirstById(scanId);
    if (!scanJob) throw new NotFoundException('Scan job not found');

    const empty: ScanComparisonResponse = {
      scanId,
      previousScanId: null,
      scoreChange: null,
      criticalIssuesChange: null,
      warningIssuesChange: null,
      documentCountChange: null,
      newIssues: [],
      resolvedIssues: [],
    };

    const [currentSnapshot] = await context.healthSnapshots.findMany({ where: { scanJobId: scanId }, take: 1 });
    if (!currentSnapshot) return empty;

    const [previousSnapshot] = await context.healthSnapshots.findMany({
      where: { capturedAt: { lt: currentSnapshot.capturedAt } },
      orderBy: { capturedAt: 'desc' },
      take: 1,
    });
    if (!previousSnapshot) return empty;

    const scoreChange =
      currentSnapshot.averageHealthScore !== null && previousSnapshot.averageHealthScore !== null
        ? currentSnapshot.averageHealthScore - previousSnapshot.averageHealthScore
        : null;

    const [currentIssues, previousIssues] = await Promise.all([
      this.issuesForScan(context, currentSnapshot.scanJobId),
      this.issuesForScan(context, previousSnapshot.scanJobId),
    ]);

    const documentIds = [...new Set([...currentIssues, ...previousIssues].map((issue) => issue.documentId))];
    const documents =
      documentIds.length > 0 ? await context.documents.findMany({ where: { id: { in: documentIds } } }) : [];
    const documentNameById = new Map(documents.map((document) => [document.id, document.name]));

    const toKey = (issue: { documentId: string; criterion: string }): string => `${issue.documentId}:${issue.criterion}`;
    const currentByKey = new Map(currentIssues.map((issue) => [toKey(issue), issue]));
    const previousByKey = new Map(previousIssues.map((issue) => [toKey(issue), issue]));

    const toComparisonIssue = (issue: {
      documentId: string;
      criterion: string;
      severity: string;
      message: string;
    }): ScanComparisonIssue => ({
      documentId: issue.documentId,
      documentName: documentNameById.get(issue.documentId) ?? 'Unknown document',
      criterion: issue.criterion,
      severity: issue.severity,
      message: issue.message,
    });

    const newIssues = [...currentByKey.entries()]
      .filter(([key]) => !previousByKey.has(key))
      .map(([, issue]) => toComparisonIssue(issue));
    const resolvedIssues = [...previousByKey.entries()]
      .filter(([key]) => !currentByKey.has(key))
      .map(([, issue]) => toComparisonIssue(issue));

    return {
      scanId,
      previousScanId: previousSnapshot.scanJobId,
      scoreChange,
      criticalIssuesChange: currentSnapshot.criticalIssuesCount - previousSnapshot.criticalIssuesCount,
      warningIssuesChange: currentSnapshot.warningIssuesCount - previousSnapshot.warningIssuesCount,
      documentCountChange: currentSnapshot.totalDocumentsScanned - previousSnapshot.totalDocumentsScanned,
      newIssues,
      resolvedIssues,
    };
  }

  // HealthIssue rows don't carry documentId directly — resolved via the
  // HealthScore they belong to (HealthScore.scanJobId + .documentId), the
  // same relation chain documents.service.ts already walks for the
  // current health view. No schema change, just a two-step batched read.
  private async issuesForScan(
    context: TenantContext,
    scanJobId: string,
  ): Promise<{ documentId: string; criterion: string; severity: string; message: string }[]> {
    const scores: HealthScore[] = await context.healthScores.findMany({ where: { scanJobId } });
    if (scores.length === 0) return [];

    const documentIdByScoreId = new Map(scores.map((score) => [score.id, score.documentId]));
    const issues: HealthIssue[] = await context.healthIssues.findMany({
      where: { healthScoreId: { in: scores.map((score) => score.id) } },
    });

    return issues.map((issue) => ({
      documentId: documentIdByScoreId.get(issue.healthScoreId) ?? '',
      criterion: issue.criterion,
      severity: issue.severity,
      message: issue.message,
    }));
  }
}
