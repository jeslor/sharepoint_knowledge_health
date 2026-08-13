import type { Client } from '@microsoft/microsoft-graph-client';
import { createGraphClient } from './client/graph-client-factory';
import { listDrives, getDrive } from './drives';
import { GraphNotFoundError } from './errors';

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

describe('listDrives', () => {
  beforeEach(() => jest.clearAllMocks());

  // Scale-hardening / metadata-integration pass: list identity now rides
  // on this same request via $expand — verifies no second, per-drive
  // request was introduced to get it.
  it('calls GET /sites/{siteId}/drives with $expand=list($select=id) — one request, no separate lookup', async () => {
    const requestedUrls: string[] = [];
    mockedCreateGraphClient.mockReturnValue({
      api: (url: string) => {
        requestedUrls.push(url);
        return { get: async () => ({ value: [] }) };
      },
    } as unknown as Client);

    await collect(listDrives('entra-tenant-1', 'site-1'));

    expect(requestedUrls).toEqual(['/sites/site-1/drives?$expand=list($select=id)']);
  });

  it('follows @odata.nextLink across multiple pages', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/site-1/drives?$expand=list($select=id)': {
          value: [{ id: 'drive-1', name: 'Documents', webUrl: 'https://x', driveType: 'documentLibrary' }],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/sites/site-1/drives?$skiptoken=abc',
        },
        'https://graph.microsoft.com/v1.0/sites/site-1/drives?$skiptoken=abc': {
          value: [{ id: 'drive-2', name: 'Reports', webUrl: 'https://x', driveType: 'documentLibrary' }],
        },
      }),
    );

    const results = await collect(listDrives('entra-tenant-1', 'site-1'));

    expect(results.map((d) => d.id)).toEqual(['drive-1', 'drive-2']);
  });

  it('passes through the expanded list id when present', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/site-1/drives?$expand=list($select=id)': {
          value: [
            { id: 'drive-1', name: 'Documents', webUrl: 'https://x', driveType: 'documentLibrary', list: { id: 'list-1' } },
          ],
        },
      }),
    );

    const [result] = await collect(listDrives('entra-tenant-1', 'site-1'));

    expect(result?.list).toEqual({ id: 'list-1' });
  });

  it('leaves list undefined when Graph omits it (documented as nullable)', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/site-1/drives?$expand=list($select=id)': {
          value: [{ id: 'drive-1', name: 'Documents', webUrl: 'https://x', driveType: 'personal' }],
        },
      }),
    );

    const [result] = await collect(listDrives('entra-tenant-1', 'site-1'));

    expect(result?.list).toBeUndefined();
  });

  it('maps a Graph failure through the shared error hierarchy', async () => {
    mockedCreateGraphClient.mockReturnValue({
      api: () => ({
        get: async () => {
          throw { statusCode: 404, code: 'itemNotFound', message: 'Site not found' };
        },
      }),
    } as unknown as Client);

    await expect(collect(listDrives('entra-tenant-1', 'site-1', { correlationId: 'corr-1' }))).rejects.toThrow(
      GraphNotFoundError,
    );
  });
});

describe('getDrive', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls GET /drives/{driveId}', async () => {
    const requestedUrls: string[] = [];
    mockedCreateGraphClient.mockReturnValue({
      api: (url: string) => {
        requestedUrls.push(url);
        return { get: async () => ({ id: 'drive-1', name: 'Documents', webUrl: 'https://x', driveType: 'documentLibrary' }) };
      },
    } as unknown as Client);

    await getDrive('entra-tenant-1', 'drive-1');

    expect(requestedUrls).toEqual(['/drives/drive-1']);
  });

  it('maps a Graph failure through the shared error hierarchy', async () => {
    mockedCreateGraphClient.mockReturnValue({
      api: () => ({
        get: async () => {
          throw { statusCode: 404, code: 'itemNotFound', message: 'Drive not found' };
        },
      }),
    } as unknown as Client);

    await expect(getDrive('entra-tenant-1', 'drive-1', { correlationId: 'corr-1' })).rejects.toThrow(GraphNotFoundError);
  });
});
