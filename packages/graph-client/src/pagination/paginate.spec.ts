import type { Client } from '@microsoft/microsoft-graph-client';
import { paginate } from './paginate';

describe('paginate', () => {
  it('yields all items across multiple pages, following @odata.nextLink', async () => {
    const pages: Record<string, { value: number[]; '@odata.nextLink'?: string }> = {
      '/start': { value: [1, 2], '@odata.nextLink': '/page2' },
      '/page2': { value: [3, 4], '@odata.nextLink': '/page3' },
      '/page3': { value: [5] },
    };
    const client = {
      api: (url: string) => ({ get: async () => pages[url] }),
    } as unknown as Client;

    const results: number[] = [];
    for await (const item of paginate<number>(client, '/start')) {
      results.push(item);
    }

    expect(results).toEqual([1, 2, 3, 4, 5]);
  });

  it('stops after a single page when there is no nextLink', async () => {
    const client = {
      api: () => ({ get: async () => ({ value: ['a', 'b'] }) }),
    } as unknown as Client;

    const results: string[] = [];
    for await (const item of paginate<string>(client, '/only')) {
      results.push(item);
    }

    expect(results).toEqual(['a', 'b']);
  });

  it('only fetches the next page when the consumer pulls another value (real backpressure)', async () => {
    const fetchedUrls: string[] = [];
    const client = {
      api: (url: string) => ({
        get: async () => {
          fetchedUrls.push(url);
          return url === '/start' ? { value: [1], '@odata.nextLink': '/page2' } : { value: [2] };
        },
      }),
    } as unknown as Client;

    const iterator = paginate<number>(client, '/start');
    await iterator.next();
    expect(fetchedUrls).toEqual(['/start']);

    await iterator.next();
    expect(fetchedUrls).toEqual(['/start', '/page2']);
  });
});
