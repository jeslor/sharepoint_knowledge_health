import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SCAN_QUEUE, type ScanJobPayload } from '@sph/types';
import { createTenantContext, type TenantContext, type Document, type DocumentOwner, type SharePointSite } from '@sph/database';
import { listDrives, listDocuments, type GraphDriveItem, GraphClientError } from '@sph/graph-client';
import { calculateScore, type DocumentOwnerInput, type SiblingDocumentInput } from '@sph/scoring';

/**
 * The Document Collector (ADR-0004, ADR-0013, ADR-0014): consumes a queued
 * ScanJob, enumerates documents only within sites an Admin has explicitly
 * Approved, persists normalized metadata, and scores every document in the
 * tenant. Metadata analysis only — no document content is ever downloaded.
 *
 * Known limitation (Phase 5 foundation): Graph's driveItem endpoint has no
 * native "review date" — that's a SharePoint custom list column, which
 * requires the separate List Items API (out of scope here). hasReviewDate
 * is always false until that's built, so every document currently reports
 * a ReviewStatus issue. This is a real gap, not a placeholder oversight.
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

    let documentsScanned = 0;
    let documentsFailed = 0;
    const errors: string[] = [];

    for (const site of approvedSites) {
      try {
        const result = await this.collectSite(context, microsoftTenant.entraTenantId, site, (count) => (documentsScanned += count));
        documentsFailed += result.itemFailures;
        await context.sharePointSites.updateById(site.id, { lastScannedAt: new Date() });
      } catch (error) {
        documentsFailed += 1;
        const message = error instanceof GraphClientError ? error.message : String(error);
        this.logger.error(`Site enumeration failed for "${site.displayName}" (${site.id}): ${message}`);
        errors.push(`Site ${site.displayName}: ${message}`);
      }
    }

    await this.scoreTenantDocuments(context, scanJobId, microsoftTenant.id);

    await context.scanJobs.updateById(scanJobId, {
      status: documentsScanned === 0 && documentsFailed > 0 ? 'Failed' : 'Completed',
      completedAt: new Date(),
      documentsScanned,
      documentsFailed,
      errorSummary: errors.length > 0 ? errors.slice(0, 20).join('; ') : null,
    });
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
          this.logger.error(`Failed to persist document ${item.id} ("${item.name}") in site "${site.displayName}": ${message}`);
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

  private async syncOwner(context: TenantContext, documentId: string, item: GraphDriveItem): Promise<void> {
    const existingOwners = await context.documentOwners.findMany({ where: { documentId } });
    for (const owner of existingOwners) {
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

  private async scoreTenantDocuments(context: TenantContext, scanJobId: string, microsoftTenantId: string): Promise<void> {
    const documents = await context.documents.findMany({
      where: { status: 'Active', site: { microsoftTenantId } },
    });
    if (documents.length === 0) return;

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
        // No source for this yet (see class-level doc comment).
        hasReviewDate: false,
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

      for (const issue of result.issues) {
        await context.healthIssues.create({
          healthScoreId: healthScore.id,
          criterion: issue.type,
          severity: issue.severity,
          message: issue.message,
        });
      }

      await context.documents.updateById(document.id, { currentHealthScoreId: healthScore.id });
    }
  }
}
