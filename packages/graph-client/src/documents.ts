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
