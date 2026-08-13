import { randomUUID } from 'crypto';
import type { Logger } from '@nestjs/common';
import type { SharePointSite, TenantContext } from '@sph/database';
import { listColumns, listContentTypes, listItemFields, listItemDriveItemIds } from '@sph/graph-client';
import { resolveReviewDateCandidates } from '@sph/review-date-discovery';

async function collectAsync<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) results.push(item);
  return results;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

interface SyncLogContext {
  organizationId: string;
  siteId: string;
  graphListId: string;
  correlationId: string;
  startedAt: number;
}

// Plain key=value lines, not JSON — matches this codebase's existing
// logging convention (apps/api's request-logger.middleware.ts) rather
// than introducing a new structured-logging dependency. Deliberately
// never includes document names, field values, or any other document
// content — only ids, counts, and status.
function logSyncSuccess(
  logger: Pick<Logger, 'log'>,
  ctx: SyncLogContext,
  status: string,
  documentsEvaluated: number,
  documentsUpdated: number,
  documentsSkippedEmpty: number,
): void {
  logger.log(
    `ReviewDateSync succeeded organizationId=${ctx.organizationId} siteId=${ctx.siteId} graphListId=${ctx.graphListId} ` +
      `status=${status} documentsEvaluated=${documentsEvaluated} documentsUpdated=${documentsUpdated} ` +
      `documentsSkippedEmpty=${documentsSkippedEmpty} durationMs=${Date.now() - ctx.startedAt} correlationId=${ctx.correlationId}`,
  );
}

function logSyncFailure(logger: Pick<Logger, 'error'>, ctx: SyncLogContext, operation: string, error: unknown): void {
  const errorType = error instanceof Error ? error.constructor.name : typeof error;
  logger.error(
    `ReviewDateSync failed organizationId=${ctx.organizationId} siteId=${ctx.siteId} graphListId=${ctx.graphListId} ` +
      `operation=${operation} errorType=${errorType} durationMs=${Date.now() - ctx.startedAt} correlationId=${ctx.correlationId}: ${errorMessage(error)}`,
    errorStack(error),
  );
}

/**
 * Phase 1b: applies a library's already-confirmed review-date mapping on
 * every scan (not a one-time ingestion read — ADR-0016 §4.3 amendment).
 * A no-op whenever no mapping exists for this (site, list) pair — column
 * discovery for *unconfirmed* libraries only happens on-demand, inside the
 * confirm action itself (apps/api), not here; this keeps scan-time Graph
 * load unchanged for every library an admin hasn't opted into. This
 * no-mapping path is deliberately not logged (Phase 1.2) — it's the
 * overwhelmingly common case on every scan (every unconfirmed library),
 * and "nothing to do" is the expected default, not a lifecycle event.
 *
 * Safety invariants, all enforced below:
 *  - A Graph failure at any step preserves whatever nextReviewDueAt/
 *    reviewDateSource a document already has and returns without touching
 *    the mapping's status or failing the caller's scan.
 *  - columnDefinitionId is re-resolved to its *current* name every run
 *    (never cached) — this is what makes a column rename transparent
 *    (id stable, name/displayName mutable) and a column deletion
 *    detectable (id no longer resolves) without any special-casing.
 *  - A deleted/unresolvable column flips the mapping to Stale and returns
 *    without writing to any Document — it never falls back to clearing a
 *    value, it just stops advancing it.
 *  - An empty or malformed field value is treated as "no value from
 *    SharePoint this row" and skipped, never written as a bad date.
 *
 * Retrieval shape: two independent, individually single-relationship-
 * expand Graph calls (listItemFields, listItemDriveItemIds) rather than
 * one combined $expand=fields(...),driveItem(...) request — Graph's own
 * query-parameter docs caution that some APIs only support expanding one
 * relationship per request, and no authoritative example of combining two
 * relationship expansions on listItem was found. Both calls are flat,
 * paginated sweeps over the same list (scale with document count / page
 * size, not folder count, and never per-document) and are joined in
 * memory by the listItem id every row shares. This roughly doubles the
 * metadata-retrieval request count relative to a single combined call,
 * but only for libraries with an Active confirmed mapping — the ~2x cost
 * applies solely to libraries an admin has explicitly opted into, never
 * tenant-wide.
 *
 * Phase 1.2 (production hardening): every Graph call below carries a
 * single correlationId, freshly generated per invocation, threaded
 * through to both the success and failure log lines — a support engineer
 * can grep one id and see every Graph request plus the outcome for one
 * sync attempt. Known, deliberately deferred efficiency optimizations
 * (delta queries, sync-state persistence, parallel drive processing,
 * caching) are documented in docs/operations/review-date-sync.md, not
 * implemented here — each changes synchronization architecture and needs
 * its own separate design, not a hardening-pass addition.
 */
export async function syncConfirmedReviewDateMapping(
  context: TenantContext,
  entraTenantId: string,
  site: SharePointSite,
  graphListId: string,
  logger: Pick<Logger, 'error' | 'log'>,
): Promise<void> {
  const ctx: SyncLogContext = {
    organizationId: context.organizationId,
    siteId: site.id,
    graphListId,
    correlationId: randomUUID(),
    startedAt: Date.now(),
  };

  const mapping = await context.sharePointReviewDateMappings.findByLibrary(site.id, graphListId);
  if (!mapping) return;

  const graphOptions = { correlationId: ctx.correlationId };

  let currentColumns;
  let currentContentTypeColumns;
  try {
    currentColumns = await collectAsync(listColumns(entraTenantId, site.graphSiteId, graphListId, graphOptions));
    const contentTypes = await collectAsync(listContentTypes(entraTenantId, site.graphSiteId, graphListId, graphOptions));
    currentContentTypeColumns = contentTypes.flatMap((ct) => ct.columns ?? []);
  } catch (error) {
    logSyncFailure(logger, ctx, 'columnDiscovery', error);
    return;
  }

  const candidates = resolveReviewDateCandidates(currentColumns, currentContentTypeColumns);
  const currentColumn = candidates.find((candidate) => candidate.id === mapping.columnDefinitionId);

  if (!currentColumn) {
    if (mapping.status !== 'Stale') {
      await context.sharePointReviewDateMappings.updateById(mapping.id, { status: 'Stale', staleDetectedAt: new Date() });
    }
    logSyncSuccess(logger, ctx, 'Stale', 0, 0, 0);
    return;
  }

  if (mapping.status === 'Stale') {
    await context.sharePointReviewDateMappings.updateById(mapping.id, { status: 'Active', staleDetectedAt: null });
  }

  let fieldRows;
  let driveItemRows;
  try {
    [fieldRows, driveItemRows] = await Promise.all([
      collectAsync(listItemFields(entraTenantId, site.graphSiteId, graphListId, currentColumn.name, graphOptions)),
      collectAsync(listItemDriveItemIds(entraTenantId, site.graphSiteId, graphListId, graphOptions)),
    ]);
  } catch (error) {
    logSyncFailure(logger, ctx, 'valueRetrieval', error);
    return;
  }

  // Joined in memory by the listItem id both sweeps share — see the
  // class-level doc comment for why this is two separate calls rather
  // than one combined $expand.
  const driveItemIdByListItemId = new Map(driveItemRows.map((row) => [row.id, row.driveItem?.id]));

  let documentsUpdated = 0;
  let documentsSkippedEmpty = 0;

  for (const row of fieldRows) {
    const graphItemId = driveItemIdByListItemId.get(row.id);
    if (!graphItemId) continue; // no correlating driveItem — not a file-backed row

    const rawValue = row.fields[currentColumn.name];
    if (rawValue === undefined || rawValue === null) {
      documentsSkippedEmpty += 1;
      continue; // column exists but empty for this item
    }

    const parsedValue = new Date(String(rawValue));
    if (Number.isNaN(parsedValue.getTime())) continue; // malformed — never write a bad date

    const [document] = await context.documents.findMany({ where: { siteId: site.id, graphItemId }, take: 1 });
    if (!document) continue; // not (yet) a document we track

    // Confirmed-mapping precedence: once an admin has explicitly confirmed
    // this library's mapping, the SharePoint value governs — including
    // superseding a previously Manual value (ADR-0016 §4.3's now-resolved
    // open question). Only writes when the value actually changed, so an
    // unchanged column produces no-op scans, not a write every time.
    if (document.nextReviewDueAt?.getTime() !== parsedValue.getTime() || document.reviewDateSource !== 'GraphMetadata') {
      await context.documents.updateById(document.id, { nextReviewDueAt: parsedValue, reviewDateSource: 'GraphMetadata' });
      documentsUpdated += 1;
    }
  }

  logSyncSuccess(logger, ctx, 'Active', fieldRows.length, documentsUpdated, documentsSkippedEmpty);
}
