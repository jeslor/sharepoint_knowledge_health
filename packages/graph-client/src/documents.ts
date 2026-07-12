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
