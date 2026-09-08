import type { GraphListItemWithFields, GraphListItemDriveItemRef } from './dto';
import type { ListOptions } from './types';
import { createGraphClient } from './client/graph-client-factory';
import { paginate } from './pagination/paginate';
import { mapGraphError } from './errors';

/**
 * GET /sites/{site-id}/lists/{list-id}/items?$expand=fields($select=...)
 * — Sites.Read.All, already granted. A single-relationship expand
 * (fields alone), the exact shape Microsoft's own fieldValueSet
 * documentation demonstrates
 * ("GET .../items?expand=fields(select=Author,BookTitle,PageCount)").
 *
 * A flat, paginated collection scoped to the whole list regardless of
 * folder nesting (unlike listDocuments/listChildren's per-folder
 * driveItem traversal) — the deliberate non-N+1 mechanism: one field's
 * values for every item in a library are retrieved via this same
 * page-following sweep, never one extra request per document.
 *
 * fieldName narrows the fields expansion to exactly the column(s) a caller
 * needs, keeping payload size down (Graph's own guidance: filtering and
 * selecting narrowly is preferred over requesting every field). A single
 * string selects one column (the review-date sync's existing usage,
 * unchanged); an array selects several in one sweep — ADR-0025's taxonomy
 * coverage needs every configured classification column for a library, and
 * `$select` natively takes a comma-separated list, so N columns are read in
 * one flat, non-N+1 pass rather than N separate sweeps.
 *
 * This call alone does not identify which driveItem (Document) each row
 * corresponds to — see listItemDriveItemIds below, which a caller joins
 * against this call's results by the shared listItem id.
 */
export async function* listItemFields(
  entraTenantId: string,
  siteId: string,
  listId: string,
  fieldName: string | string[],
  options?: ListOptions,
): AsyncGenerator<GraphListItemWithFields> {
  const client = createGraphClient(entraTenantId);
  const select = Array.isArray(fieldName) ? fieldName.join(',') : fieldName;
  try {
    yield* paginate<GraphListItemWithFields>(client, `/sites/${siteId}/lists/${listId}/items?$expand=fields($select=${select})`);
  } catch (error) {
    throw mapGraphError(error, options?.correlationId);
  }
}

/**
 * GET /sites/{site-id}/lists/{list-id}/items?$expand=driveItem($select=id)
 * — same permission, same flat/paginated/non-N+1 shape as listItemFields
 * above, but expands the single driveItem relationship instead of fields.
 * Deliberately a separate request, not combined into one $expand with
 * fields — see the GraphListItemDriveItemRef doc comment in dto.ts for
 * why. A caller joins this call's rows against listItemFields' rows by
 * the shared listItem id (both enumerate the same list, so the ids are
 * common) to associate a field value with the Document it belongs to
 * (keyed on driveItem.id / Document.graphItemId).
 */
export async function* listItemDriveItemIds(
  entraTenantId: string,
  siteId: string,
  listId: string,
  options?: ListOptions,
): AsyncGenerator<GraphListItemDriveItemRef> {
  const client = createGraphClient(entraTenantId);
  try {
    yield* paginate<GraphListItemDriveItemRef>(client, `/sites/${siteId}/lists/${listId}/items?$expand=driveItem($select=id)`);
  } catch (error) {
    throw mapGraphError(error, options?.correlationId);
  }
}
