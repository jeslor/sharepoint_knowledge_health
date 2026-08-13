import type { Client } from '@microsoft/microsoft-graph-client';
import { createGraphClient } from './client/graph-client-factory';
import { listColumns, listContentTypes } from './columns';
import { GraphPermissionError } from './errors';

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

describe('listColumns', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls GET /sites/{siteId}/lists/{listId}/columns', async () => {
    const requestedUrls: string[] = [];
    mockedCreateGraphClient.mockReturnValue({
      api: (url: string) => {
        requestedUrls.push(url);
        return { get: async () => ({ value: [] }) };
      },
    } as unknown as Client);

    await collect(listColumns('entra-tenant-1', 'site-1', 'list-1'));

    expect(requestedUrls).toEqual(['/sites/site-1/lists/list-1/columns']);
  });

  it('follows @odata.nextLink across multiple pages', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/site-1/lists/list-1/columns': {
          value: [{ id: 'col-1', name: 'Title', displayName: 'Title' }],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/sites/site-1/lists/list-1/columns?$skiptoken=abc',
        },
        'https://graph.microsoft.com/v1.0/sites/site-1/lists/list-1/columns?$skiptoken=abc': {
          value: [{ id: 'col-2', name: 'ReviewDate', displayName: 'Review Date', dateTime: {} }],
        },
      }),
    );

    const results = await collect(listColumns('entra-tenant-1', 'site-1', 'list-1'));

    expect(results.map((c) => c.id)).toEqual(['col-1', 'col-2']);
  });

  it('passes through the dateTime facet unmodified', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/site-1/lists/list-1/columns': {
          value: [
            { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', hidden: false, dateTime: { format: 'dateOnly' } },
          ],
        },
      }),
    );

    const [result] = await collect(listColumns('entra-tenant-1', 'site-1', 'list-1'));

    expect(result?.dateTime).toEqual({ format: 'dateOnly' });
  });

  it('passes through isDeletable unmodified when present', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/site-1/lists/list-1/columns': {
          value: [{ id: 'col-1', name: 'Created', displayName: 'Created', dateTime: {}, isDeletable: false }],
        },
      }),
    );

    const [result] = await collect(listColumns('entra-tenant-1', 'site-1', 'list-1'));

    expect(result?.isDeletable).toBe(false);
  });

  it('maps a Graph failure through the shared error hierarchy', async () => {
    mockedCreateGraphClient.mockReturnValue({
      api: () => ({
        get: async () => {
          throw { statusCode: 403, code: 'accessDenied', message: 'Forbidden' };
        },
      }),
    } as unknown as Client);

    await expect(collect(listColumns('entra-tenant-1', 'site-1', 'list-1', { correlationId: 'corr-1' }))).rejects.toThrow(
      GraphPermissionError,
    );
  });
});

describe('listContentTypes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls GET /sites/{siteId}/lists/{listId}/contentTypes with $expand=columns', async () => {
    const requestedUrls: string[] = [];
    mockedCreateGraphClient.mockReturnValue({
      api: (url: string) => {
        requestedUrls.push(url);
        return { get: async () => ({ value: [] }) };
      },
    } as unknown as Client);

    await collect(listContentTypes('entra-tenant-1', 'site-1', 'list-1'));

    expect(requestedUrls).toEqual(['/sites/site-1/lists/list-1/contentTypes?$expand=columns']);
  });

  it('yields each content type with its nested columns intact', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/site-1/lists/list-1/contentTypes?$expand=columns': {
          value: [
            {
              id: 'ct-1',
              name: 'Document',
              columns: [{ id: 'col-3', name: 'NextReview', displayName: 'Next Review', dateTime: {} }],
            },
          ],
        },
      }),
    );

    const [result] = await collect(listContentTypes('entra-tenant-1', 'site-1', 'list-1'));

    expect(result?.columns).toEqual([{ id: 'col-3', name: 'NextReview', displayName: 'Next Review', dateTime: {} }]);
  });

  it('maps a Graph failure through the shared error hierarchy', async () => {
    mockedCreateGraphClient.mockReturnValue({
      api: () => ({
        get: async () => {
          throw { statusCode: 403, code: 'accessDenied', message: 'Forbidden' };
        },
      }),
    } as unknown as Client);

    await expect(
      collect(listContentTypes('entra-tenant-1', 'site-1', 'list-1', { correlationId: 'corr-1' })),
    ).rejects.toThrow(GraphPermissionError);
  });
});
