import type { Client } from '@microsoft/microsoft-graph-client';
import { createGraphClient } from './client/graph-client-factory';
import { listChildren } from './documents';
import { GraphThrottledError } from './errors';

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
