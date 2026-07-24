import type { Client } from '@microsoft/microsoft-graph-client';
import { createGraphClient } from './client/graph-client-factory';
import { listSites } from './sites';
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

describe('listSites', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls GET /sites/getAllSites, not the search-based endpoint', async () => {
    const requestedUrls: string[] = [];
    mockedCreateGraphClient.mockReturnValue({
      api: (url: string) => {
        requestedUrls.push(url);
        return { get: async () => ({ value: [] }) };
      },
    } as unknown as Client);

    await collect(listSites('entra-tenant-1'));

    expect(requestedUrls).toEqual(['/sites/getAllSites']);
  });

  it('follows @odata.nextLink across multiple pages', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/getAllSites': {
          value: [{ id: 'site-1', webUrl: 'https://contoso.sharepoint.com', displayName: 'Site 1' }],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/sites/getAllSites?$skiptoken=abc',
        },
        'https://graph.microsoft.com/v1.0/sites/getAllSites?$skiptoken=abc': {
          value: [{ id: 'site-2', webUrl: 'https://contoso.sharepoint.com/sites/site2', displayName: 'Site 2' }],
        },
      }),
    );

    const results = await collect(listSites('entra-tenant-1'));

    expect(results.map((site) => site.id)).toEqual(['site-1', 'site-2']);
  });

  it('maps id, webUrl, displayName, and isPersonalSite from a normal site', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/getAllSites': {
          value: [
            {
              id: 'site-1',
              webUrl: 'https://contoso.sharepoint.com/sites/finance',
              displayName: 'Finance',
              name: 'Finance',
              isPersonalSite: false,
            },
          ],
        },
      }),
    );

    const [result] = await collect(listSites('entra-tenant-1'));

    expect(result).toEqual({
      id: 'site-1',
      webUrl: 'https://contoso.sharepoint.com/sites/finance',
      displayName: 'Finance',
      isPersonalSite: false,
    });
  });

  it('maps isPersonalSite: true for a personal OneDrive site', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/getAllSites': {
          value: [
            {
              id: 'personal-1',
              webUrl: 'https://contoso-my.sharepoint.com/personal/alice',
              displayName: 'Alice',
              isPersonalSite: true,
            },
          ],
        },
      }),
    );

    const [result] = await collect(listSites('entra-tenant-1'));

    expect(result?.isPersonalSite).toBe(true);
  });

  // Root cause regression test: verified live against a real tenant that
  // getAllSites' built-in Search Center system site has neither displayName
  // nor name set at all.
  it('falls back to name when displayName is missing', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/getAllSites': {
          value: [{ id: 'site-1', webUrl: 'https://contoso.sharepoint.com/sites/x', name: 'X Site' }],
        },
      }),
    );

    const [result] = await collect(listSites('entra-tenant-1'));

    expect(result?.displayName).toBe('X Site');
  });

  it('falls back to webUrl when both displayName and name are missing (e.g. the built-in Search Center)', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/getAllSites': {
          value: [{ id: 'site-1', webUrl: 'https://contoso.sharepoint.com/search' }],
        },
      }),
    );

    const [result] = await collect(listSites('entra-tenant-1'));

    expect(result?.displayName).toBe('https://contoso.sharepoint.com/search');
  });

  it('defaults isPersonalSite to false when Graph omits the field', async () => {
    mockedCreateGraphClient.mockReturnValue(
      fakeClient({
        '/sites/getAllSites': {
          value: [{ id: 'site-1', webUrl: 'https://contoso.sharepoint.com', displayName: 'Site 1' }],
        },
      }),
    );

    const [result] = await collect(listSites('entra-tenant-1'));

    expect(result?.isPersonalSite).toBe(false);
  });

  it('maps a Graph failure through the shared error hierarchy', async () => {
    mockedCreateGraphClient.mockReturnValue({
      api: () => ({
        get: async () => {
          throw { statusCode: 404, code: 'itemNotFound', message: 'Requested site could not be found' };
        },
      }),
    } as unknown as Client);

    await expect(collect(listSites('entra-tenant-1', { correlationId: 'corr-1' }))).rejects.toThrow(GraphNotFoundError);
  });
});
