import type { GraphDrive } from './dto';
import type { ListOptions } from './types';
import { createGraphClient } from './client/graph-client-factory';
import { paginate } from './pagination/paginate';
import { mapGraphError } from './errors';

// $expand=list($select=id) piggybacks the SharePoint list identity (drive's
// documented "list" relationship) onto this same, already-happening
// request — deliberately not a separate per-drive lookup. Narrowed to just
// `id` since that's the only field any caller needs (list column
// discovery/item retrieval take a list id, not a full list resource).
export async function* listDrives(
  entraTenantId: string,
  siteId: string,
  options?: ListOptions,
): AsyncGenerator<GraphDrive> {
  const client = createGraphClient(entraTenantId);
  try {
    yield* paginate<GraphDrive>(client, `/sites/${siteId}/drives?$expand=list($select=id)`);
  } catch (error) {
    throw mapGraphError(error, options?.correlationId);
  }
}

export async function getDrive(entraTenantId: string, driveId: string, options?: ListOptions): Promise<GraphDrive> {
  const client = createGraphClient(entraTenantId);
  try {
    return await client.api(`/drives/${driveId}`).get();
  } catch (error) {
    throw mapGraphError(error, options?.correlationId);
  }
}
