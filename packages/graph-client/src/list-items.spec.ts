import type { Client } from '@microsoft/microsoft-graph-client';
import { createGraphClient } from './client/graph-client-factory';
import { listItemFields, listItemDriveItemIds } from './list-items';
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

describe('listItemFields', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requests the list items collection with a single-relationship fields expand, narrowed to the given column', async () => {
    const requestedUrls: string[] = [];
    mockedCreateGraphClient.mockReturnValue({
      api: (url: string) => {
        requestedUrls.push(url);
        return { get: async () => ({ value: [] }) };
      },
    } as unknown as Client);

    await collect(listItemFields('entra-tenant-1', 'site-1', 'list-1', 'ReviewDate'));

    expect(requestedUrls).toEqual(['/sites/site-1/lists/list-1/items?$expand=fields($select=ReviewDate)']);
  });

  it('follows @odata.nextLink across multiple pages — this is the flat, non-N+1 sweep', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/site-1/lists/list-1/items?$expand=fields($select=ReviewDate)': {
          value: [{ id: '1', fields: { ReviewDate: '2026-12-01' } }],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/sites/site-1/lists/list-1/items?$skiptoken=abc',
        },
        'https://graph.microsoft.com/v1.0/sites/site-1/lists/list-1/items?$skiptoken=abc': {
          value: [{ id: '2', fields: {} }],
        },
      }),
    );

    const results = await collect(listItemFields('entra-tenant-1', 'site-1', 'list-1', 'ReviewDate'));

    expect(results.map((r) => r.id)).toEqual(['1', '2']);
  });

  it('returns the field value under the requested column name', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/site-1/lists/list-1/items?$expand=fields($select=ReviewDate)': {
          value: [{ id: '1', fields: { ReviewDate: '2026-12-01' } }],
        },
      }),
    );

    const [result] = await collect(listItemFields('entra-tenant-1', 'site-1', 'list-1', 'ReviewDate'));

    expect(result?.fields.ReviewDate).toBe('2026-12-01');
  });

  it('yields an item with an empty fields object when the column has no value set (not a special case)', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/site-1/lists/list-1/items?$expand=fields($select=ReviewDate)': {
          value: [{ id: '1', fields: {} }],
        },
      }),
    );

    const [result] = await collect(listItemFields('entra-tenant-1', 'site-1', 'list-1', 'ReviewDate'));

    expect(result?.fields.ReviewDate).toBeUndefined();
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
      collect(listItemFields('entra-tenant-1', 'site-1', 'list-1', 'ReviewDate', { correlationId: 'corr-1' })),
    ).rejects.toThrow(GraphThrottledError);
  });
});

describe('listItemDriveItemIds', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requests the list items collection with a single-relationship driveItem expand — never combined with fields', async () => {
    const requestedUrls: string[] = [];
    mockedCreateGraphClient.mockReturnValue({
      api: (url: string) => {
        requestedUrls.push(url);
        return { get: async () => ({ value: [] }) };
      },
    } as unknown as Client);

    await collect(listItemDriveItemIds('entra-tenant-1', 'site-1', 'list-1'));

    expect(requestedUrls).toEqual(['/sites/site-1/lists/list-1/items?$expand=driveItem($select=id)']);
  });

  it('follows @odata.nextLink across multiple pages', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/site-1/lists/list-1/items?$expand=driveItem($select=id)': {
          value: [{ id: '1', driveItem: { id: 'drive-item-1' } }],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/sites/site-1/lists/list-1/items?$skiptoken=abc',
        },
        'https://graph.microsoft.com/v1.0/sites/site-1/lists/list-1/items?$skiptoken=abc': {
          value: [{ id: '2', driveItem: { id: 'drive-item-2' } }],
        },
      }),
    );

    const results = await collect(listItemDriveItemIds('entra-tenant-1', 'site-1', 'list-1'));

    expect(results.map((r) => r.id)).toEqual(['1', '2']);
  });

  it('returns the correlating driveItem id, joinable against listItemFields by the shared listItem id', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/site-1/lists/list-1/items?$expand=driveItem($select=id)': {
          value: [{ id: '1', driveItem: { id: 'drive-item-1' } }],
        },
      }),
    );

    const [result] = await collect(listItemDriveItemIds('entra-tenant-1', 'site-1', 'list-1'));

    expect(result?.id).toBe('1');
    expect(result?.driveItem?.id).toBe('drive-item-1');
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
      collect(listItemDriveItemIds('entra-tenant-1', 'site-1', 'list-1', { correlationId: 'corr-1' })),
    ).rejects.toThrow(GraphThrottledError);
  });
});
