import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import {
  SCAN_QUEUE,
  NOTIFICATION_RECONCILIATION_QUEUE,
  type ScanJobPayload,
  type NotificationReconciliationJobPayload,
} from '@sph/types';
import { createTenantContext, type TenantContext, type Document, type DocumentOwner, type SharePointSite } from '@sph/database';
import {
  listDrives,
  listDocuments,
  listChildren,
  listColumns,
  listContentTypes,
  listItemFields,
  listItemDriveItemIds,
  type GraphDriveItem,
  type GraphColumnDefinition,
  GraphClientError,
} from '@sph/graph-client';
import { calculateScore, type SiblingDocumentInput, type ClassificationFieldInput } from '@sph/scoring';
import { syncConfirmedReviewDateMapping } from '../sharepoint-metadata/review-date-sync';
import { buildScoringInput } from '../scoring/build-scoring-input';
import { resolveActiveColumns, buildClassificationFieldInputs } from '../scoring/classification-coverage';

async function collectAsync<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

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
 * ReviewStatus scoring input (ADR-0002 amendments, 2026-07-23 and
 * 2026-08-13): `nextReviewDueAt` is passed straight through from
 * `Document.nextReviewDueAt` — set either manually (`PATCH
 * /organizations/:id/documents/:documentId/review`, `reviewDateSource:
 * Manual`) or by the SharePoint review-date sync
 * (`sharepoint-metadata/review-date-sync.ts`, `reviewDateSource:
 * GraphMetadata`) — scoreReviewStatus itself now does the date-vs-`now`
 * comparison (Missing/Overdue/Healthy), not this call site.
 */
@Processor(SCAN_QUEUE, { concurrency: Number(process.env.WORKER_CONCURRENCY) || 5 })
export class DocumentCollectorProcessor extends WorkerHost {
  private readonly logger = new Logger(DocumentCollectorProcessor.name);

  constructor(
    @InjectQueue(NOTIFICATION_RECONCILIATION_QUEUE)
    private readonly reconciliationQueue: Queue<NotificationReconciliationJobPayload>,
  ) {
    super();
  }

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
    const summary = await this.scoreTenantDocuments(
      context,
      scanJobId,
      microsoftTenant.id,
      microsoftTenant.entraTenantId,
      status === 'Completed',
    );

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

      // ADR-0021 §3.3: event-driven reconciliation trigger — the primary
      // mechanism, only meaningful after a genuinely successful scan (the
      // same "only trust complete data" gate the HealthSnapshot above
      // already uses). A single follow-up enqueue, not reconciliation
      // logic itself — that lives entirely in apps/worker/src/notifications,
      // its own separate processor. Never allowed to turn an otherwise-
      // successful scan into a failed job: a Redis blip here is logged and
      // left to the periodic safety-net sweep to recover, exactly like
      // DiscoveryProducerService's own best-effort enqueue after bootstrap.
      try {
        await this.reconciliationQueue.add('reconcile-org', { organizationId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to enqueue notification reconciliation for org ${organizationId}: ${message}`);
      }
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

    // ADR-0020 §4: a folder-expansion failure isolates to that folder (the
    // rest of the traversal continues) but means seenGraphItemIds can no
    // longer be trusted as a COMPLETE picture — extends ADR-0004's existing
    // "a partial/failed enumeration never marks anything Removed" rule to
    // this new, finer-grained failure surface. Previously this was only
    // ever implicitly true (a listDrives/listDocuments failure threw out of
    // this whole method, skipping reconciliation below entirely); now that
    // a folder failure no longer aborts the method, it must be tracked
    // explicitly instead.
    let enumerationComplete = true;

    for await (const drive of listDrives(entraTenantId, site.graphSiteId)) {
      for await (const item of this.walkDrive(entraTenantId, drive.id, (folderId, error) => {
        itemFailures += 1;
        enumerationComplete = false;
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        this.logger.error(
          `Failed to expand folder ${folderId} in drive "${drive.name}" (${drive.id}), site "${site.displayName}": ${message}`,
          stack,
        );
      })) {
        seenGraphItemIds.add(item.id);

        try {
          await this.upsertDocument(context, site.id, item, drive.list?.id);
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

      // SharePoint metadata integration, Phase 1b: a no-op for any library
      // without a confirmed mapping (checked first thing inside, before any
      // Graph call — see review-date-sync.ts). Isolated per drive, same
      // failure-containment precedent as every other per-item/per-folder
      // try/catch in this method — a metadata sync failure must never
      // abort document collection or scoring for the rest of this site.
      if (drive.list?.id) {
        try {
          await syncConfirmedReviewDateMapping(context, entraTenantId, site, drive.list.id, this.logger);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const stack = error instanceof Error ? error.stack : undefined;
          this.logger.error(
            `Review-date mapping sync failed for drive "${drive.name}" (${drive.id}), site "${site.displayName}": ${message}`,
            stack,
          );
        }
      }
    }

    // Enumeration reached the end successfully, so seenGraphItemIds is a
    // complete picture of what currently exists — safe to reconcile.
    // A document deleted from SharePoint since the last scan otherwise
    // stays Active (and keeps being scored) forever.
    if (enumerationComplete) {
      await this.reconcileRemovedDocuments(context, site.id, seenGraphItemIds);
    }

    return { itemFailures };
  }

  /**
   * ADR-0020: iterative (not recursive-call) traversal of one drive's
   * complete folder tree, starting from its root. Yields only genuine file
   * items, streamed as they're discovered — folders are expanded
   * internally and never yielded themselves, and nothing is materialized
   * in full (ADR-0020 §5).
   *
   * ADR-0020 §3: any item carrying a `remoteItem` facet — whether shaped as
   * a file, a folder, or both — is discarded before the file/folder
   * branch: never yielded (so never persisted) and never enqueued (so
   * never traversed). This is a hard trust-boundary rule (ADR-0014), not
   * an optimization — a remoteItem points into a DIFFERENT drive,
   * potentially a different, non-Approved site.
   *
   * No depth cap (ADR-0020 §4) — the complete tree is always walked. A
   * visited-folder-id set is defense-in-depth against a Graph anomaly or
   * future bug re-expanding the same folder (a true cycle isn't possible
   * within one drive's own tree). A failure expanding one folder is
   * reported via onFolderExpansionFailed and does not abort the rest of
   * the traversal — sibling and already-queued folders are still
   * attempted.
   */
  private async *walkDrive(
    entraTenantId: string,
    driveId: string,
    onFolderExpansionFailed: (folderId: string, error: unknown) => void,
  ): AsyncGenerator<GraphDriveItem> {
    const visitedFolderIds = new Set<string>();
    const pendingFolderIds: string[] = [];

    yield* this.classifyChildren(listDocuments(entraTenantId, driveId), pendingFolderIds, visitedFolderIds);

    while (pendingFolderIds.length > 0) {
      const folderId = pendingFolderIds.shift();
      if (folderId === undefined) break; // unreachable given the length check above; keeps types honest

      try {
        yield* this.classifyChildren(listChildren(entraTenantId, driveId, folderId), pendingFolderIds, visitedFolderIds);
      } catch (error) {
        onFolderExpansionFailed(folderId, error);
      }
    }
  }

  /**
   * Classifies one page-following stream of children: yields file items,
   * enqueues not-yet-visited folder items for later expansion, and
   * discards any remoteItem-carrying item unconditionally (ADR-0020 §3).
   */
  private async *classifyChildren(
    children: AsyncGenerator<GraphDriveItem>,
    pendingFolderIds: string[],
    visitedFolderIds: Set<string>,
  ): AsyncGenerator<GraphDriveItem> {
    for await (const item of children) {
      if (item.remoteItem !== undefined) continue; // never persisted, never traversed — ADR-0020 §3

      if (item.folder) {
        if (!visitedFolderIds.has(item.id)) {
          visitedFolderIds.add(item.id);
          pendingFolderIds.push(item.id);
        }
        continue; // folders are never themselves persisted as documents
      }

      if (item.file) {
        yield item;
      }
      // Neither file nor folder (e.g. a Graph "package" facet) — inert,
      // matches the existing safe default for any non-file item.
    }
  }

  private async reconcileRemovedDocuments(context: TenantContext, siteId: string, seenGraphItemIds: Set<string>): Promise<void> {
    const activeDocuments = await context.documents.findMany({ where: { siteId, status: 'Active' } });
    for (const document of activeDocuments) {
      if (!seenGraphItemIds.has(document.graphItemId)) {
        await context.documents.updateById(document.id, { status: 'Removed' });

        // Phase D.2 review fix: the Removed transition above has already
        // committed and must never be rolled back by a notification
        // failure — a removed document is never reconsidered by a future
        // scan (it no longer appears in activeDocuments), so an uncaught
        // failure here would silently and permanently lose that
        // assignee's notification, and would also abort the rest of this
        // site's removed documents (this loop would never reach them).
        // Isolating per-document, matching this file's own existing
        // per-item isolation precedent (upsertDocument's catch below).
        try {
          await this.notifyRemovedDocumentAssignees(context, document.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const stack = error instanceof Error ? error.stack : undefined;
          this.logger.error(`Failed to notify assignees for removed document ${document.id}: ${message}`, stack);
        }
      }
    }
  }

  // ADR-0021 §3.4: a removed document's still-open GovernanceIssues would
  // otherwise go stale silently — the assignee would keep working toward
  // fixing an issue on a document that no longer exists. No
  // GovernanceActivity write here: that model requires a non-nullable
  // actorUserId (ADR-0016), and this is a worker-detected system event, not
  // a human/API action. No automatic status change either — removal isn't
  // resolution; a human decides whether to resolve, reassign, or leave the
  // issue as-is (e.g. the document reappears on a later scan).
  private async notifyRemovedDocumentAssignees(context: TenantContext, documentId: string): Promise<void> {
    const openIssues = await context.governanceIssues.findMany({
      where: { documentId, status: { in: ['Open', 'InProgress'] } },
    });
    for (const issue of openIssues) {
      if (!issue.assignedUserId) continue; // no resolvable recipient

      // Isolated per-issue too — a document with more than one open issue
      // must not have a later issue's notification skipped just because an
      // earlier one on the same document failed.
      try {
        await context.notifications.create({
          userId: issue.assignedUserId,
          type: 'DocumentRemoved',
          message: `The document for a governance issue you're assigned to (${issue.issueType}) was removed from SharePoint.`,
          governanceIssueId: issue.id,
          documentId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        this.logger.error(`Failed to create DocumentRemoved notification for issue ${issue.id}: ${message}`, stack);
      }
    }
  }

  private async upsertDocument(
    context: TenantContext,
    siteId: string,
    item: GraphDriveItem,
    graphListId: string | undefined,
  ): Promise<Document> {
    const [existing] = await context.documents.findMany({ where: { siteId, graphItemId: item.id }, take: 1 });

    const data = {
      siteId,
      graphItemId: item.id,
      name: item.name,
      path: item.parentReference.path,
      fileType: item.file?.mimeType ?? 'unknown',
      webUrl: item.webUrl,
      sizeBytes: BigInt(item.size),
      sourceCreatedAt: new Date(item.createdDateTime),
      sourceModifiedAt: new Date(item.lastModifiedDateTime),
      // SharePoint metadata integration, Phase 1a: undefined (not null)
      // when this scan's drive had no resolvable list — leaves a
      // previously-persisted value untouched on update (Prisma omits
      // undefined keys) rather than flapping it, since a drive's list
      // association is a structural property, not expected to appear and
      // disappear between scans.
      ...(graphListId !== undefined ? { graphListId } : {}),
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

  /**
   * ADR-0025: per-library classification-coverage collection. Reads the
   * tenant-designated columns' values for every document in each library
   * that has classification fields, via the same flat, non-N+1 list-item
   * sweep review-date sync uses. Resolution against live Graph columns
   * drives the Active/Stale lifecycle: a vanished column is marked Stale
   * (excluded from the denominator); a stale column that resolves again is
   * re-activated. A Graph failure for one library leaves its documents
   * unmeasured (neutral Taxonomy), never failing the scan. Libraries with no
   * configured fields make zero Graph calls.
   */
  private async collectClassificationCoverage(
    context: TenantContext,
    entraTenantId: string,
    documents: Document[],
  ): Promise<Map<string, ClassificationFieldInput[]>> {
    const coverage = new Map<string, ClassificationFieldInput[]>();

    const librariesByKey = new Map<string, { siteId: string; graphListId: string; documents: Document[] }>();
    for (const document of documents) {
      if (!document.graphListId) continue;
      const key = `${document.siteId}::${document.graphListId}`;
      const entry = librariesByKey.get(key) ?? { siteId: document.siteId, graphListId: document.graphListId, documents: [] };
      entry.documents.push(document);
      librariesByKey.set(key, entry);
    }
    if (librariesByKey.size === 0) return coverage;

    const siteIds = [...new Set([...librariesByKey.values()].map((library) => library.siteId))];
    const sites = await context.sharePointSites.findMany({ where: { id: { in: siteIds } } });
    const graphSiteIdBySiteId = new Map(sites.map((site) => [site.id, site.graphSiteId]));

    for (const library of librariesByKey.values()) {
      const allFields = await context.sharePointClassificationFields.findManyByLibrary(library.siteId, library.graphListId);
      if (allFields.length === 0) continue; // no policy -> neutral, no Graph call
      const graphSiteId = graphSiteIdBySiteId.get(library.siteId);
      if (!graphSiteId) continue;

      try {
        const [columns, contentTypes] = await Promise.all([
          collectAsync(listColumns(entraTenantId, graphSiteId, library.graphListId)),
          collectAsync(listContentTypes(entraTenantId, graphSiteId, library.graphListId)),
        ]);
        const liveColumns: GraphColumnDefinition[] = [...columns, ...contentTypes.flatMap((contentType) => contentType.columns ?? [])];

        const { resolved, staleIds } = resolveActiveColumns(allFields, liveColumns);

        // Active/Stale lifecycle transitions, mirroring review-date sync.
        for (const field of allFields) {
          const isResolved = resolved.some((column) => column.fieldId === field.id);
          if (!isResolved && field.status === 'Active') {
            await context.sharePointClassificationFields.updateById(field.id, { status: 'Stale', staleDetectedAt: new Date() });
          } else if (isResolved && field.status === 'Stale') {
            await context.sharePointClassificationFields.updateById(field.id, { status: 'Active', staleDetectedAt: null });
          }
        }

        if (resolved.length === 0) continue; // every field stale -> D=0 -> neutral

        const [fieldRows, driveItemRows] = await Promise.all([
          collectAsync(listItemFields(entraTenantId, graphSiteId, library.graphListId, resolved.map((column) => column.columnName))),
          collectAsync(listItemDriveItemIds(entraTenantId, graphSiteId, library.graphListId)),
        ]);
        const graphItemIdByListItemId = new Map(driveItemRows.map((row) => [row.id, row.driveItem?.id]));
        const fieldsByGraphItemId = new Map<string, Record<string, unknown>>();
        for (const row of fieldRows) {
          const graphItemId = graphItemIdByListItemId.get(row.id);
          if (graphItemId) fieldsByGraphItemId.set(graphItemId, row.fields as Record<string, unknown>);
        }

        for (const document of library.documents) {
          coverage.set(document.id, buildClassificationFieldInputs(resolved, fieldsByGraphItemId.get(document.graphItemId)));
        }
      } catch (error) {
        this.logger.warn(`Classification coverage collection failed for library ${library.graphListId}: ${String(error)}`);
      }
    }

    return coverage;
  }

  private async scoreTenantDocuments(
    context: TenantContext,
    scanJobId: string,
    microsoftTenantId: string,
    entraTenantId: string,
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

    // ADR-0025: per-document classification coverage. Empty map entries (or a
    // missing entry) mean the library has no active classification policy, so
    // Taxonomy scores a neutral 100 — the common case makes zero Graph calls.
    const classificationByDocumentId = await this.collectClassificationCoverage(context, entraTenantId, documents);

    let totalScore = 0;
    let criticalIssuesCount = 0;
    let warningIssuesCount = 0;

    // One shared instant for every document scored in this batch — every
    // document in the same scan is judged against the same "now" for
    // Overdue/Healthy, rather than each drifting by however long the loop
    // takes to reach it (ADR-0002 amendment, 2026-08-13: "pass now
    // explicitly, never call new Date() inside the scoring function").
    const scoringNow = new Date();

    for (const document of documents) {
      const key = `${document.name}::${document.sizeBytes}`;
      // ADR-0022 Phase 5: this mapping is now shared with rescore-document.ts's
      // single-document rescore path (buildScoringInput, apps/worker/src/scoring) —
      // extracted unchanged, so this loop's behavior is identical to before.
      const result = calculateScore(
        buildScoringInput(
          document,
          ownersByDocumentId.get(document.id) ?? [],
          activeByEmail,
          siblingsByKey.get(key) ?? [],
          scoringNow,
          classificationByDocumentId.get(document.id) ?? [],
        ),
      );

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
        taxonomyScore: result.breakdown.Taxonomy,
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
