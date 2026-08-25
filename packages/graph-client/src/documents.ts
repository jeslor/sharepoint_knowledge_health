import type { GraphDriveItem } from './dto';
import type { ListOptions } from './types';
import { createGraphClient } from './client/graph-client-factory';
import { paginate } from './pagination/paginate';
import { mapGraphError } from './errors';

export async function* listDocuments(
  entraTenantId: string,
  driveId: string,
  options?: ListOptions,
): AsyncGenerator<GraphDriveItem> {
  const client = createGraphClient(entraTenantId);
  try {
    yield* paginate<GraphDriveItem>(client, `/drives/${driveId}/root/children`);
  } catch (error) {
    throw mapGraphError(error, options?.correlationId);
  }
}

/**
 * ADR-0020: lists a specific item's children — unlike listDocuments (root
 * only), this works for any item id, which is what makes recursive folder
 * traversal possible. Deliberately a separate function rather than a
 * parameter added to listDocuments: keeps listDocuments's existing
 * signature/behavior untouched, and mirrors Graph's own resource shape
 * (GET /drives/{driveId}/items/{itemId}/children) directly, consistent
 * with ADR-0013 §9 — this is a generic Graph operation with no knowledge
 * of scans, traversal policy, or exclusion rules, all of which live in
 * apps/worker instead.
 */
export async function* listChildren(
  entraTenantId: string,
  driveId: string,
  itemId: string,
  options?: ListOptions,
): AsyncGenerator<GraphDriveItem> {
  const client = createGraphClient(entraTenantId);
  try {
    yield* paginate<GraphDriveItem>(client, `/drives/${driveId}/items/${itemId}/children`);
  } catch (error) {
    throw mapGraphError(error, options?.correlationId);
  }
}

export async function getDocument(
  entraTenantId: string,
  driveId: string,
  itemId: string,
  options?: ListOptions,
): Promise<GraphDriveItem> {
  const client = createGraphClient(entraTenantId);
  try {
    return await client.api(`/drives/${driveId}/items/${itemId}`).get();
  } catch (error) {
    throw mapGraphError(error, options?.correlationId);
  }
}

/**
 * ADR-0013 (Amendment, 2026-08-13 — Narrow SharePoint List-Item Field
 * Write, Phase 3A-2): the one narrow, explicit exception to this module's
 * otherwise-read-only surface. PATCH /drives/{driveId}/items/{itemId}/listItem/fields
 * — the same drive/driveItem resource path getDocument/listChildren above
 * already use, navigated to that item's associated list-item fields.
 * `itemId` is the driveItem id (the same id `getDocument` takes, and what
 * this product persists as `Document.graphItemId`) — there is no separate
 * SharePoint list-item id to resolve for this call.
 *
 * `fields` is intentionally `Record<string, string>`, not `unknown` — this
 * amendment's one sanctioned use is setting a date-typed column, always a
 * string value on the wire (an ISO 8601 date string), and narrowing the
 * type here is cheaper than a runtime check for the one shape this
 * function is scoped to support.
 *
 * Returns void, not the updated resource: matches ADR-0013's exact
 * decision — the caller (SetReviewDateAction, ADR-0022) verifies the
 * write via its own separate, already-existing read call, never by
 * trusting this PATCH's own response body.
 */
export async function updateListItemFields(
  entraTenantId: string,
  driveId: string,
  itemId: string,
  fields: Record<string, string>,
  options?: ListOptions,
): Promise<void> {
  const client = createGraphClient(entraTenantId);
  try {
    await client.api(`/drives/${driveId}/items/${itemId}/listItem/fields`).patch(fields);
  } catch (error) {
    throw mapGraphError(error, options?.correlationId);
  }
}
