import type { GraphColumnDefinition, GraphContentType } from './dto';
import type { ListOptions } from './types';
import { createGraphClient } from './client/graph-client-factory';
import { paginate } from './pagination/paginate';
import { mapGraphError } from './errors';

/**
 * GET /sites/{site-id}/lists/{list-id}/columns — Sites.Read.All, already
 * granted (no new consent). Returns list-level column definitions. Whether
 * this already includes every column provisioned onto the list via a
 * content type isn't explicitly documented by Graph; callers that need a
 * guaranteed-complete set should also union with listContentTypeColumns
 * below rather than assume this alone is exhaustive.
 */
export async function* listColumns(
  entraTenantId: string,
  siteId: string,
  listId: string,
  options?: ListOptions,
): AsyncGenerator<GraphColumnDefinition> {
  const client = createGraphClient(entraTenantId);
  try {
    yield* paginate<GraphColumnDefinition>(client, `/sites/${siteId}/lists/${listId}/columns`);
  } catch (error) {
    throw mapGraphError(error, options?.correlationId);
  }
}

/**
 * GET /sites/{site-id}/lists/{list-id}/contentTypes?$expand=columns —
 * same Sites.Read.All permission, no new consent. One request per list
 * (content-type counts per list are small in practice), returning each
 * content type together with its own columnDefinition collection so a
 * caller can defensively union against listColumns, deduplicated by
 * columnDefinition.id, without assuming list-level discovery alone is
 * exhaustive.
 */
export async function* listContentTypes(
  entraTenantId: string,
  siteId: string,
  listId: string,
  options?: ListOptions,
): AsyncGenerator<GraphContentType> {
  const client = createGraphClient(entraTenantId);
  try {
    yield* paginate<GraphContentType>(client, `/sites/${siteId}/lists/${listId}/contentTypes?$expand=columns`);
  } catch (error) {
    throw mapGraphError(error, options?.correlationId);
  }
}
