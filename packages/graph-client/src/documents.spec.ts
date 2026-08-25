import type { Client } from '@microsoft/microsoft-graph-client';
import { createGraphClient } from './client/graph-client-factory';
import { listChildren, updateListItemFields } from './documents';
import {
  GraphThrottledError,
  GraphTransientError,
  GraphPermissionError,
  GraphNotFoundError,
  GraphAuthenticationError,
} from './errors';

jest.mock('./client/graph-client-factory');

const mockedCreateGraphClient = createGraphClient as jest.MockedFunction<typeof createGraphClient>;

function fakeClient(pages: Record<string, { value: unknown[]; '@odata.nextLink'?: string }>): Client {
  return { api: (url: string) => ({ get: async () => pages[url] }) } as unknown as Client;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) results.push(item);
  return results;
}

// ADR-0020: listChildren is what makes recursive traversal possible —
// unlike listDocuments (root only), it works for any item id.
describe('listChildren', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls GET /drives/{driveId}/items/{itemId}/children for the given folder id', async () => {
    const requestedUrls: string[] = [];
    mockedCreateGraphClient.mockReturnValue({
      api: (url: string) => {
        requestedUrls.push(url);
        return { get: async () => ({ value: [] }) };
      },
    } as unknown as Client);

    await collect(listChildren('entra-tenant-1', 'drive-1', 'folder-1'));

    expect(requestedUrls).toEqual(['/drives/drive-1/items/folder-1/children']);
  });

  it('follows @odata.nextLink across multiple pages', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/drives/drive-1/items/folder-1/children': {
          value: [{ id: 'item-1', name: 'a.docx' }],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive-1/items/folder-1/children?$skiptoken=abc',
        },
        'https://graph.microsoft.com/v1.0/drives/drive-1/items/folder-1/children?$skiptoken=abc': {
          value: [{ id: 'item-2', name: 'b.docx' }],
        },
      }),
    );

    const results = await collect(listChildren('entra-tenant-1', 'drive-1', 'folder-1'));

    expect(results.map((item: { id: string }) => item.id)).toEqual(['item-1', 'item-2']);
  });

  it('passes through file, folder, and remoteItem facets unmodified (no field remapping, unlike listSites)', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/drives/drive-1/items/folder-1/children': {
          value: [
            { id: 'file-1', name: 'Report.docx', file: { mimeType: 'application/vnd.ms-word' } },
            { id: 'folder-1', name: 'Subfolder', folder: { childCount: 3 } },
            { id: 'shortcut-1', name: 'Shared shortcut', folder: { childCount: 1 }, remoteItem: { id: 'remote-1' } },
          ],
        },
      }),
    );

    const results = await collect(listChildren('entra-tenant-1', 'drive-1', 'folder-1'));

    expect(results).toEqual([
      { id: 'file-1', name: 'Report.docx', file: { mimeType: 'application/vnd.ms-word' } },
      { id: 'folder-1', name: 'Subfolder', folder: { childCount: 3 } },
      { id: 'shortcut-1', name: 'Shared shortcut', folder: { childCount: 1 }, remoteItem: { id: 'remote-1' } },
    ]);
  });

  it('maps a Graph failure through the shared error hierarchy', async () => {
    mockedCreateGraphClient.mockReturnValue({
      api: () => ({
        get: async () => {
          throw { statusCode: 429, code: 'activityLimitReached', message: 'Throttled' };
        },
      }),
    } as unknown as Client);

    await expect(
      collect(listChildren('entra-tenant-1', 'drive-1', 'folder-1', { correlationId: 'corr-1' })),
    ).rejects.toThrow(GraphThrottledError);
  });
});

// ADR-0013 (Amendment, 2026-08-13 — Narrow SharePoint List-Item Field
// Write, Phase 3A-2): the one write function in this otherwise read-only
// module. ADR-0022 §13.4 (corrected 2026-08-22): itemId is the driveItem
// id (Document.graphItemId) — no separate list-item id involved.
describe('updateListItemFields', () => {
  beforeEach(() => jest.clearAllMocks());

  it('PATCHes /drives/{driveId}/items/{itemId}/listItem/fields with exactly the given fields', async () => {
    let requestedUrl: string | undefined;
    let requestedBody: unknown;
    mockedCreateGraphClient.mockReturnValue({
      api: (url: string) => {
        requestedUrl = url;
        return {
          patch: async (body: unknown) => {
            requestedBody = body;
          },
        };
      },
    } as unknown as Client);

    await updateListItemFields('entra-tenant-1', 'drive-1', 'item-1', { ReviewDate: '2026-12-01' });

    expect(requestedUrl).toBe('/drives/drive-1/items/item-1/listItem/fields');
    expect(requestedBody).toEqual({ ReviewDate: '2026-12-01' });
  });

  it('resolves to undefined on success — the caller must verify via its own separate read, not this response', async () => {
    mockedCreateGraphClient.mockReturnValue({
      api: () => ({ patch: async () => ({ id: 'item-1', fields: { ReviewDate: '2026-12-01' } }) }),
    } as unknown as Client);

    await expect(updateListItemFields('entra-tenant-1', 'drive-1', 'item-1', { ReviewDate: '2026-12-01' })).resolves.toBeUndefined();
  });

  it('maps a 403 to GraphPermissionError (Sites.ReadWrite.All missing or revoked)', async () => {
    mockedCreateGraphClient.mockReturnValue({
      api: () => ({
        patch: async () => {
          throw { statusCode: 403, code: 'accessDenied', message: 'Access denied' };
        },
      }),
    } as unknown as Client);

    await expect(
      updateListItemFields('entra-tenant-1', 'drive-1', 'item-1', { ReviewDate: '2026-12-01' }),
    ).rejects.toThrow(GraphPermissionError);
  });

  it('maps a 404 to GraphNotFoundError (item deleted or moved before the write)', async () => {
    mockedCreateGraphClient.mockReturnValue({
      api: () => ({
        patch: async () => {
          throw { statusCode: 404, code: 'itemNotFound', message: 'The item was not found' };
        },
      }),
    } as unknown as Client);

    await expect(
      updateListItemFields('entra-tenant-1', 'drive-1', 'item-1', { ReviewDate: '2026-12-01' }),
    ).rejects.toThrow(GraphNotFoundError);
  });

  it('maps a 429 to GraphThrottledError (surfaces only after the SDK\'s own RetryHandler middleware has already exhausted its retries)', async () => {
    mockedCreateGraphClient.mockReturnValue({
      api: () => ({
        patch: async () => {
          throw { statusCode: 429, code: 'activityLimitReached', message: 'Throttled' };
        },
      }),
    } as unknown as Client);

    await expect(
      updateListItemFields('entra-tenant-1', 'drive-1', 'item-1', { ReviewDate: '2026-12-01' }),
    ).rejects.toThrow(GraphThrottledError);
  });

  it('maps a 5xx (other than 503, which is throttling) to GraphTransientError (retryable, not permanent)', async () => {
    mockedCreateGraphClient.mockReturnValue({
      api: () => ({
        patch: async () => {
          throw { statusCode: 502, code: 'internalServerError', message: 'Bad gateway' };
        },
      }),
    } as unknown as Client);

    await expect(
      updateListItemFields('entra-tenant-1', 'drive-1', 'item-1', { ReviewDate: '2026-12-01' }),
    ).rejects.toThrow(GraphTransientError);
  });

  it('propagates a token-acquisition/authentication failure as GraphAuthenticationError, not a document-level permanent failure', async () => {
    mockedCreateGraphClient.mockReturnValue({
      api: () => ({
        patch: async () => {
          throw { statusCode: 401, code: 'InvalidAuthenticationToken', message: 'Access token is empty' };
        },
      }),
    } as unknown as Client);

    await expect(
      updateListItemFields('entra-tenant-1', 'drive-1', 'item-1', { ReviewDate: '2026-12-01' }),
    ).rejects.toThrow(GraphAuthenticationError);
  });

  it('threads correlationId through to the mapped error, exactly like every existing read function', async () => {
    mockedCreateGraphClient.mockReturnValue({
      api: () => ({
        patch: async () => {
          throw { statusCode: 403, code: 'accessDenied', message: 'Access denied' };
        },
      }),
    } as unknown as Client);

    await expect(
      updateListItemFields('entra-tenant-1', 'drive-1', 'item-1', { ReviewDate: '2026-12-01' }, { correlationId: 'corr-1' }),
    ).rejects.toMatchObject({ correlationId: 'corr-1' });
  });

  it('acquires the Graph client via the same createGraphClient(entraTenantId) path every other function uses — no second auth path', async () => {
    mockedCreateGraphClient.mockReturnValue({
      api: () => ({ patch: async () => undefined }),
    } as unknown as Client);

    await updateListItemFields('entra-tenant-2', 'drive-1', 'item-1', { ReviewDate: '2026-12-01' });

    expect(mockedCreateGraphClient).toHaveBeenCalledWith('entra-tenant-2');
  });
});
