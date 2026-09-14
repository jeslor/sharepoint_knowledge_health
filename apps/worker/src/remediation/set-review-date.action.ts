import { randomUUID } from 'crypto';
import type { Document, TenantContext } from '@sph/database';
import { GraphNotFoundError, listColumns, listContentTypes, listDrives, listItemDriveItemIds, listItemFields, updateListItemFields } from '@sph/graph-client';
import { resolveReviewDateCandidates } from '@sph/review-date-discovery';

async function collectAsync<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) results.push(item);
  return results;
}

export interface SetReviewDateActionContext {
  entraTenantId: string;
  tenantContext: TenantContext;
  // Threaded through every Graph call this action makes — defaults to a
  // fresh id if the caller (Phase 4's worker) doesn't supply one, matching
  // syncConfirmedReviewDateMapping's exact per-invocation correlationId
  // convention (review-date-sync.ts).
  correlationId?: string;
}

export interface SetReviewDateActionPayload {
  // ISO 8601 — the exact shape ADR-0022 §6's own example RemediationJob.payload
  // uses ({ "nextReviewDueAt": "2026-09-30T00:00:00.000Z" }). Parsing/validating
  // the raw RemediationJob.payload Json blob into this shape is Phase 4's
  // (worker's) responsibility, not this action's.
  nextReviewDueAt: string;
}

/**
 * ADR-0022 §3.4/§13.3: a successful PATCH is never sufficient on its own —
 * 'verified' means the subsequent targeted re-fetch confirmed the written
 * value; 'unverified' means the write returned success but the re-fetch
 * did not confirm it (no Graph error occurred — see the doc comment below
 * for how a genuine Graph error during verification is handled instead).
 * This action never decides RemediationItemStatus itself (Phase 3 does not
 * touch that enum) — it only reports what it observed; Phase 4 owns the
 * "unverified stays Pending" decision (§13.3).
 */
export type SetReviewDateActionResult =
  // 'verified' carries the exact review date read back from SharePoint (the
  // value the caller must synchronize into the local Document — ADR-0022
  // write-back MVP, so governance can resolve immediately rather than
  // waiting for the next full scan's sync). It equals the requested value by
  // definition of verification, but is taken from the Graph re-read so the
  // local state mirrors what SharePoint actually persisted.
  | { outcome: 'verified'; verifiedReviewDate: Date }
  | { outcome: 'unverified' };

/**
 * ADR-0022 §3.2's action shape (execute(context, document, payload) →
 * Result), implemented as a single plain function — no generic
 * `RemediationAction` interface/registry is introduced, since exactly one
 * action exists today and a second is explicitly not built until this one
 * is proven (ADR-0022 §3.2's own stated sequencing).
 *
 * Error behavior: this function never catches or reclassifies a Graph
 * error — every `GraphClientError` subclass (`GraphPermissionError`,
 * `GraphNotFoundError`, `GraphThrottledError`, `GraphTransientError`,
 * `GraphAuthenticationError`) from any Graph call below propagates to the
 * caller untouched, exactly like every existing Graph-calling orchestration
 * layer in this codebase (document-collector.processor.ts,
 * syncConfirmedReviewDateMapping) already does — Phase 4's worker classifies
 * retryable vs. permanent the same way those callers already do, without
 * this action duplicating that logic. A precondition failure that is NOT a
 * Graph error (no graphListId, no Active mapping, the mapped column no
 * longer resolves) throws a plain Error instead, so callers can distinguish
 * "Graph rejected this" from "this document was never eligible."
 *
 * Drive ID resolution (ADR-0022 §13.4, corrected): `document.graphItemId`
 * is already the driveItem id `updateListItemFields` needs — there is no
 * separate SharePoint list-item id to resolve. The one remaining lookup is
 * `driveId`, resolved via the existing `listDrives` read, matching the
 * drive whose `list.id` equals `document.graphListId` — the same
 * site-scoped drive enumeration `document-collector.processor.ts` already
 * performs at scan time, re-run here for the one drive this document's
 * library belongs to. No new persisted field, no new mapping table.
 *
 * Review-date field resolution: reuses `SharePointReviewDateMapping`
 * exactly as `syncConfirmedReviewDateMapping` (review-date-sync.ts) already
 * does — the mapping's `columnDefinitionId` is the stable key;  the
 * column's *current* internal name is re-resolved fresh on every call via
 * `listColumns`/`listContentTypes`/`resolveReviewDateCandidates`, never
 * cached, so a column rename is transparent and a deletion is detected
 * (the id no longer resolves) rather than silently writing to a stale name.
 */
export async function executeSetReviewDateAction(
  context: SetReviewDateActionContext,
  document: Document,
  payload: SetReviewDateActionPayload,
): Promise<SetReviewDateActionResult> {
  const correlationId = context.correlationId ?? randomUUID();
  const graphOptions = { correlationId };

  if (!document.graphListId) {
    throw new Error(`Document ${document.id} has no graphListId — not eligible for review-date remediation`);
  }
  const graphListId = document.graphListId;

  const site = await context.tenantContext.sharePointSites.findFirstById(document.siteId);
  if (!site) {
    throw new Error(`SharePointSite ${document.siteId} not found for document ${document.id}`);
  }

  const mapping = await context.tenantContext.sharePointReviewDateMappings.findByLibrary(site.id, graphListId);
  if (!mapping || mapping.status !== 'Active') {
    throw new Error(`No Active SharePointReviewDateMapping for site ${site.id} list ${graphListId}`);
  }

  const [currentColumns, contentTypes] = await Promise.all([
    collectAsync(listColumns(context.entraTenantId, site.graphSiteId, graphListId, graphOptions)),
    collectAsync(listContentTypes(context.entraTenantId, site.graphSiteId, graphListId, graphOptions)),
  ]);
  const currentContentTypeColumns = contentTypes.flatMap((ct) => ct.columns ?? []);
  const candidates = resolveReviewDateCandidates(currentColumns, currentContentTypeColumns);
  const currentColumn = candidates.find((candidate) => candidate.id === mapping.columnDefinitionId);
  if (!currentColumn) {
    throw new Error(`Review-date column ${mapping.columnDefinitionId} no longer resolves for list ${graphListId} (mapping may be Stale)`);
  }

  let driveId: string | undefined;
  for await (const drive of listDrives(context.entraTenantId, site.graphSiteId, graphOptions)) {
    if (drive.list?.id === graphListId) {
      driveId = drive.id;
      break;
    }
  }
  if (!driveId) {
    throw new GraphNotFoundError(`No drive found under site ${site.graphSiteId} backing list ${graphListId}`, undefined, correlationId);
  }

  await updateListItemFields(context.entraTenantId, driveId, document.graphItemId, { [currentColumn.name]: payload.nextReviewDueAt }, graphOptions);

  // Targeted verification (§3.4) — reuses the exact two-generator join
  // syncConfirmedReviewDateMapping already relies on (listItemFields keyed
  // by listItem id, listItemDriveItemIds joining listItem id -> driveItem
  // id), narrowed here to the one row matching this document's own
  // graphItemId, rather than a full-list sync. Any Graph error during
  // either read propagates untouched, same as the write above — only a
  // clean read that doesn't confirm the value produces 'unverified'.
  const [verifyFieldRows, verifyDriveItemRows] = await Promise.all([
    collectAsync(listItemFields(context.entraTenantId, site.graphSiteId, graphListId, currentColumn.name, graphOptions)),
    collectAsync(listItemDriveItemIds(context.entraTenantId, site.graphSiteId, graphListId, graphOptions)),
  ]);
  const listItemIdByDriveItemId = new Map(
    verifyDriveItemRows.filter((row): row is typeof row & { driveItem: { id: string } } => row.driveItem?.id !== undefined).map((row) => [row.driveItem.id, row.id]),
  );
  const targetListItemId = listItemIdByDriveItemId.get(document.graphItemId);
  const targetRow = targetListItemId !== undefined ? verifyFieldRows.find((row) => row.id === targetListItemId) : undefined;

  const rawValue = targetRow?.fields[currentColumn.name];
  const verified =
    rawValue !== undefined && rawValue !== null && new Date(String(rawValue)).getTime() === new Date(payload.nextReviewDueAt).getTime();

  if (!verified) return { outcome: 'unverified' };
  return { outcome: 'verified', verifiedReviewDate: new Date(String(rawValue)) };
}
