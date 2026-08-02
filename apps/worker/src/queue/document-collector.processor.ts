import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SCAN_QUEUE, type ScanJobPayload } from '@sph/types';
import { createTenantContext, type TenantContext, type Document, type DocumentOwner, type SharePointSite } from '@sph/database';
import { listDrives, listDocuments, type GraphDriveItem, GraphClientError } from '@sph/graph-client';
import { calculateScore, type DocumentOwnerInput, type SiblingDocumentInput } from '@sph/scoring';

/**
 * ADR-0015 §3 — the exact aggregate a HealthSnapshot needs, computed once
 * as a side effect of scoring every document (no extra queries). Mirrors
 * apps/api's HealthSummaryService aggregation intentionally — apps/worker
 * cannot import from apps/api (ADR-0009), so this is a deliberate,
 * self-contained duplication of the same small calculation, not a shared
 * dependency.
 */
interface ScanAggregateSummary {
  totalDocumentsScanned: number;
  averageHealthScore: number | null;
  criticalIssuesCount: number;
  warningIssuesCount: number;
}

/**
 * The Document Collector (ADR-0004, ADR-0013, ADR-0014): consumes a queued
 * ScanJob, enumerates documents only within sites an Admin has explicitly
 * Approved, persists normalized metadata, and scores every document in the
 * tenant. Metadata analysis only — no document content is ever downloaded.
 *
 * ReviewStatus scoring input (ADR-0002 amendment, accepted 2026-07-23):
 * Graph's driveItem endpoint has no native "review date" — that's a
 * SharePoint custom list column, which requires the separate List Items
 * API that packages/graph-client does not implement (ADR-0013 §8). Until
 * that exists, `hasReviewDate` reflects `Document.nextReviewDueAt`, set
 * only via `PATCH /organizations/:id/documents/:documentId/review`
 * (`reviewDateSource: Manual`) — the only review-date source that exists
 * today. A document nobody has set a review date for continues to fail
 * ReviewStatus exactly as before; this only stops it being *unconditional*.
 */
@Processor(SCAN_QUEUE, { concurrency: Number(process.env.WORKER_CONCURRENCY) || 5 })
export class DocumentCollectorProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentCollectorProcessor.name);

  // BullMQ retries the job itself (see defaultJobOptions on the queue) —
  // these only make retries and terminal failures observable, since
  // otherwise a crashed job leaves no trace beyond Redis's internal state.
  @OnWorkerEvent('failed')
  onFailed(job: Job<ScanJobPayload> | undefined, error: Error): void {
    this.logger.error(
      `Job ${job?.id ?? 'unknown'} (scanJobId=${job?.data.scanJobId ?? 'unknown'}) failed: ${error.message}`,
      error.stack,
    );
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error(`Worker error: ${error.message}`, error.stack);
  }

  async process(job: Job<ScanJobPayload>): Promise<void> {
    const { organizationId, scanJobId } = job.data;
    const context = createTenantContext(organizationId);

    const scanJob = await context.scanJobs.findFirstById(scanJobId);
    if (!scanJob) {
      this.logger.warn(`ScanJob ${scanJobId} not found for organization ${organizationId}, skipping`);
      return;
    }

    const microsoftTenant = await context.microsoftTenants.findFirstById(scanJob.microsoftTenantId);
    if (!microsoftTenant) {
      await context.scanJobs.updateById(scanJobId, {
        status: 'Failed',
        completedAt: new Date(),
        errorSummary: `MicrosoftTenant ${scanJob.microsoftTenantId} not found`,
      });
      return;
    }

    await context.scanJobs.updateById(scanJobId, { status: 'Running', startedAt: new Date() });

    // ADR-0014's enforcement point: never anything but Approved sites.
    const approvedSites = await context.sharePointSites.findMany({
      where: { microsoftTenantId: microsoftTenant.id, status: 'Approved' },
    });

    // ADR-0015 §5: live progress, written at the same per-site granularity
    // the collection loop already operates at — not per-document, which
    // would be excessive write volume for a large tenant.
    await context.scanJobs.updateById(scanJobId, { totalSites: approvedSites.length });

    let documentsScanned = 0;
    let documentsFailed = 0;
    let sitesCompleted = 0;
    const errors: string[] = [];

    for (const site of approvedSites) {
      await context.scanJobs.updateById(scanJobId, { currentSiteName: site.displayName });

      try {
        const result = await this.collectSite(context, microsoftTenant.entraTenantId, site, (count) => (documentsScanned += count));
        documentsFailed += result.itemFailures;
        await context.sharePointSites.updateById(site.id, { lastScannedAt: new Date() });
      } catch (error) {
        documentsFailed += 1;
        const message = error instanceof GraphClientError ? error.message : String(error);
        // F6: previously logged only `message`, dropping the stack — the
        // real §5.7.2 LAT incident ("fetch failed") couldn't be root-caused
        // beyond "a network-layer failure" from logs alone. Matches the
        // (message, stack) shape onFailed/onError above already use.
        const stack = error instanceof Error ? error.stack : undefined;
        this.logger.error(`Site enumeration failed for "${site.displayName}" (${site.id}): ${message}`, stack);
        errors.push(`Site ${site.displayName}: ${message}`);
      }

      sitesCompleted += 1;
      await context.scanJobs.updateById(scanJobId, { sitesCompleted });
    }

    await context.scanJobs.updateById(scanJobId, { currentSiteName: null });

    // Determined here, before scoring, since it depends only on the
    // site-collection loop above — scoring itself never affects it. Moving
    // this up (unchanged in what it computes) is what lets scoring below
    // know, up front, whether this scan's results are eligible to become
    // each document's "current" state.
    const status = documentsScanned === 0 && documentsFailed > 0 ? 'Failed' : 'Completed';

    // F3 fix: a scan's HealthScore/HealthIssue rows are always written as
    // history (unconditional, below) — but Document.currentHealthScoreId
    // must only be repointed when this scan actually succeeded. Otherwise a
    // Failed scan (e.g. every site failed to collect) silently promotes a
    // freshly-computed-but-unvalidated score over the last genuinely
    // successful one. Mirrors the HealthSnapshot gate a few lines below,
    // which already only fires on `status === 'Completed'`.
    const summary = await this.scoreTenantDocuments(context, scanJobId, microsoftTenant.id, status === 'Completed');

    await context.scanJobs.updateById(scanJobId, {
      status,
      completedAt: new Date(),
      documentsScanned,
      documentsFailed,
      errorSummary: errors.length > 0 ? errors.slice(0, 20).join('; ') : null,
    });

    // ADR-0015 §3: snapshot only a genuinely successful scan — a Failed
    // scan's aggregate isn't a meaningful "current state" data point, and
    // scanJobId is unique on HealthSnapshot (at most one per scan).
    if (status === 'Completed') {
      await context.healthSnapshots.create({
        scanJobId,
        totalDocumentsScanned: summary.totalDocumentsScanned,
        averageHealthScore: summary.averageHealthScore,
        criticalIssuesCount: summary.criticalIssuesCount,
        warningIssuesCount: summary.warningIssuesCount,
      });
    }
  }

  private async collectSite(
    context: TenantContext,
    entraTenantId: string,
    site: SharePointSite,
    onDocumentPersisted: (count: number) => void,
  ): Promise<{ itemFailures: number }> {
    // Every file-item id Graph reports for this site, regardless of whether
    // persisting it succeeds — reconciliation below must be based on what
    // Graph told us exists, never on what we managed to write.
    const seenGraphItemIds = new Set<string>();
    let itemFailures = 0;

    for await (const drive of listDrives(entraTenantId, site.graphSiteId)) {
      for await (const item of listDocuments(entraTenantId, drive.id)) {
        if (!item.file) continue; // folders carry no `file` facet — not a document
        seenGraphItemIds.add(item.id);

        try {
          await this.upsertDocument(context, site.id, item);
          onDocumentPersisted(1);
        } catch (error) {
          itemFailures += 1;
          const message = error instanceof Error ? error.message : String(error);
          // F6: same fix as the site-enumeration catch above — full stack,
          // not just the message string.
          const stack = error instanceof Error ? error.stack : undefined;
          this.logger.error(`Failed to persist document ${item.id} ("${item.name}") in site "${site.displayName}": ${message}`, stack);
        }
      }
    }

    // Enumeration reached the end successfully, so seenGraphItemIds is a
    // complete picture of what currently exists — safe to reconcile.
    // A document deleted from SharePoint since the last scan otherwise
    // stays Active (and keeps being scored) forever.
    await this.reconcileRemovedDocuments(context, site.id, seenGraphItemIds);

    return { itemFailures };
  }

  private async reconcileRemovedDocuments(context: TenantContext, siteId: string, seenGraphItemIds: Set<string>): Promise<void> {
    const activeDocuments = await context.documents.findMany({ where: { siteId, status: 'Active' } });
    for (const document of activeDocuments) {
      if (!seenGraphItemIds.has(document.graphItemId)) {
        await context.documents.updateById(document.id, { status: 'Removed' });
      }
    }
  }

  private async upsertDocument(context: TenantContext, siteId: string, item: GraphDriveItem): Promise<Document> {
    const [existing] = await context.documents.findMany({ where: { siteId, graphItemId: item.id }, take: 1 });

    const data = {
      siteId,
      graphItemId: item.id,
      name: item.name,
      path: item.parentReference.path,
      fileType: item.file?.mimeType ?? 'unknown',
      sizeBytes: BigInt(item.size),
      sourceCreatedAt: new Date(item.createdDateTime),
      sourceModifiedAt: new Date(item.lastModifiedDateTime),
    };

    const document = existing
      ? ((await context.documents.updateById(existing.id, data)) ?? existing)
      : await context.documents.create(data);

    await this.syncOwner(context, document.id, item);
    return document;
  }

  // ADR-0016 §4.2: source partitions ownership writes between this worker
  // and the governance API — only ever touches source: GraphMetadata rows.
  // A ManualAssignment row (Phase 8B) is never read, deleted, or recreated
  // here, so a manual assignment survives every future rescan unchanged.
  private async syncOwner(context: TenantContext, documentId: string, item: GraphDriveItem): Promise<void> {
    const existingGraphOwners = await context.documentOwners.findMany({
      where: { documentId, source: 'GraphMetadata' },
    });
    for (const owner of existingGraphOwners) {
      await context.documentOwners.deleteById(owner.id);
    }

    const author = item.createdBy?.user;
    if (!author) return; // no ownership signal from Graph for this item

    await context.documentOwners.create({
      documentId,
      ownerType: 'Author',
      displayName: author.displayName ?? null,
      email: author.email ?? null,
      source: 'GraphMetadata',
    });
  }

  private async scoreTenantDocuments(
    context: TenantContext,
    scanJobId: string,
    microsoftTenantId: string,
    shouldUpdateCurrentHealthScore: boolean,
  ): Promise<ScanAggregateSummary> {
    const documents = await context.documents.findMany({
      where: { status: 'Active', site: { microsoftTenantId } },
    });
    if (documents.length === 0) {
      return { totalDocumentsScanned: 0, averageHealthScore: null, criticalIssuesCount: 0, warningIssuesCount: 0 };
    }

    const documentIds = documents.map((document) => document.id);

    const owners = await context.documentOwners.findMany({ where: { documentId: { in: documentIds } } });
    const ownersByDocumentId = new Map<string, DocumentOwner[]>();
    for (const owner of owners) {
      const list = ownersByDocumentId.get(owner.documentId) ?? [];
      list.push(owner);
      ownersByDocumentId.set(owner.documentId, list);
    }

    const ownerEmails = owners.map((owner) => owner.email).filter((email): email is string => email !== null);
    const registeredUsers = ownerEmails.length > 0 ? await context.users.findMany({ where: { email: { in: ownerEmails } } }) : [];
    const activeByEmail = new Map(registeredUsers.map((user) => [user.email, user.status === 'Active']));

    const siblingsByKey = new Map<string, SiblingDocumentInput[]>();
    for (const document of documents) {
      const key = `${document.name}::${document.sizeBytes}`;
      const list = siblingsByKey.get(key) ?? [];
      list.push({ id: document.id, name: document.name, sizeBytes: Number(document.sizeBytes) });
      siblingsByKey.set(key, list);
    }

    let totalScore = 0;
    let criticalIssuesCount = 0;
    let warningIssuesCount = 0;

    for (const document of documents) {
      const key = `${document.name}::${document.sizeBytes}`;
      const ownerInputs: DocumentOwnerInput[] = (ownersByDocumentId.get(document.id) ?? []).map((owner) => ({
        email: owner.email,
        isActiveUser: owner.email !== null ? (activeByEmail.get(owner.email) ?? null) : null,
      }));

      const result = calculateScore({
        documentId: document.id,
        documentName: document.name,
        sourceCreatedAt: document.sourceCreatedAt,
        sourceModifiedAt: document.sourceModifiedAt,
        sizeBytes: Number(document.sizeBytes),
        // See class-level doc comment — Manual is the only source today.
        hasReviewDate: document.nextReviewDueAt !== null,
        owners: ownerInputs,
        siblingDocuments: siblingsByKey.get(key) ?? [],
      });

      const healthScore = await context.healthScores.create({
        documentId: document.id,
        scanJobId,
        compositeScore: result.score,
        freshnessScore: result.breakdown.Freshness,
        ownershipScore: result.breakdown.Ownership,
        reviewStatusScore: result.breakdown.ReviewStatus,
        metadataScore: result.breakdown.Metadata,
        duplicationScore: result.breakdown.Duplication,
        ageScore: result.breakdown.Age,
        healthBand: result.band,
      });

      totalScore += result.score;

      for (const issue of result.issues) {
        await context.healthIssues.create({
          healthScoreId: healthScore.id,
          criterion: issue.type,
          severity: issue.severity,
          message: issue.message,
        });

        if (issue.severity === 'RequiresReview') criticalIssuesCount += 1;
        if (issue.severity === 'NeedsAttention') warningIssuesCount += 1;
      }

      // F3 fix: never promote a Failed scan's results as "current" — the
      // HealthScore/HealthIssue rows just above are still written
      // unconditionally (history is preserved either way).
      if (shouldUpdateCurrentHealthScore) {
        await context.documents.updateById(document.id, { currentHealthScoreId: healthScore.id });
      }
    }

    return {
      totalDocumentsScanned: documents.length,
      averageHealthScore: Math.round(totalScore / documents.length),
      criticalIssuesCount,
      warningIssuesCount,
    };
  }
}
