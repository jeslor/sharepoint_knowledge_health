import type { Client } from '@microsoft/microsoft-graph-client';

interface GraphPage<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

/**
 * Hand-rolled async generator following @odata.nextLink, used instead of
 * the SDK's PageIterator (callback-based, no real backpressure — ADR-0013
 * §4). The next page is only fetched when the consumer pulls the next
 * value, so a caller can `for await` over an entire collection without
 * ever buffering it into memory.
 */
export async function* paginate<T>(client: Client, initialUrl: string): AsyncGenerator<T> {
  let url: string | undefined = initialUrl;
  while (url) {
    const page = (await client.api(url).get()) as GraphPage<T>;
    yield* page.value;
    url = page['@odata.nextLink'];
  }
}
