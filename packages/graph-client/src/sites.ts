import type { GraphSite } from './dto';
import type { ListOptions } from './types';
import { createGraphClient } from './client/graph-client-factory';
import { paginate } from './pagination/paginate';
import { mapGraphError } from './errors';

// The raw GET /sites/getAllSites page shape — deliberately not the same as
// the public GraphSite DTO. Verified live against a real tenant: displayName
// and name can both be absent for a tenant-provisioned system site (e.g. the
// built-in Search Center), which is why listSites() below maps this into
// GraphSite defensively rather than casting it directly.
interface GraphAllSitesItem {
  id: string;
  webUrl: string;
  displayName?: string;
  name?: string;
  isPersonalSite?: boolean;
}

/**
 * ADR-0013 §4/§8, amended: enumerates every site collection in the tenant
 * via GET /sites/getAllSites, not the SharePoint-search-backed
 * GET /sites?search=. Live testing against a real tenant found the
 * search-backed endpoint can miss sites the app-only token can otherwise
 * read directly — a private site excluded from the search index, and a
 * freshly-created site whose search index hadn't caught up yet — neither of
 * which getAllSites depends on, since it enumerates site collections
 * directly rather than querying a search index. See ADR-0013's
 * implementation note for the full investigation.
 */
export async function* listSites(entraTenantId: string, options?: ListOptions): AsyncGenerator<GraphSite> {
  const client = createGraphClient(entraTenantId);
  try {
    for await (const site of paginate<GraphAllSitesItem>(client, '/sites/getAllSites')) {
      yield {
        id: site.id,
        webUrl: site.webUrl,
        // webUrl is the last-resort fallback so a discovered site never gets
        // a blank name — verified necessary live (the tenant's built-in
        // Search Center system site has neither field set).
        displayName: site.displayName ?? site.name ?? site.webUrl,
        isPersonalSite: site.isPersonalSite ?? false,
      };
    }
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
