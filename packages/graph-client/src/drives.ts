import type { GraphDrive } from './dto';
import type { ListOptions } from './types';
import { createGraphClient } from './client/graph-client-factory';
import { paginate } from './pagination/paginate';
import { mapGraphError } from './errors';

export async function* listDrives(
  entraTenantId: string,
  siteId: string,
  options?: ListOptions,
): AsyncGenerator<GraphDrive> {
  const client = createGraphClient(entraTenantId);
  try {
    yield* paginate<GraphDrive>(client, `/sites/${siteId}/drives`);
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
