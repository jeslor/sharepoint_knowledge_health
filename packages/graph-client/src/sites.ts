import type { GraphSite } from './dto';
import type { ListOptions } from './types';
import { createGraphClient } from './client/graph-client-factory';
import { paginate } from './pagination/paginate';
import { mapGraphError } from './errors';

export async function* listSites(
  entraTenantId: string,
  options?: ListOptions & { search?: string },
): AsyncGenerator<GraphSite> {
  const client = createGraphClient(entraTenantId);
  const search = options?.search ?? '*';
  try {
    yield* paginate<GraphSite>(client, `/sites?search=${encodeURIComponent(search)}`);
  } catch (error) {
    throw mapGraphError(error, options?.correlationId);
  }
}

export async function getSite(entraTenantId: string, siteId: string, options?: ListOptions): Promise<GraphSite> {
  const client = createGraphClient(entraTenantId);
  try {
    return await client.api(`/sites/${siteId}`).get();
  } catch (error) {
    throw mapGraphError(error, options?.correlationId);
  }
}
