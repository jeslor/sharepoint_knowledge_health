import { apiRequest, ApiError } from '../client';

describe('apiRequest — request timeout (Phase 7, LAT F2)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('rejects with a timeout ApiError when the request never settles', async () => {
    jest.useFakeTimers();
    // Faithful mock of real fetch/AbortController interop: the returned
    // promise only settles once the signal actually aborts.
    global.fetch = jest.fn((_url: string, options?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }) as unknown as typeof fetch;

    const promise = apiRequest('/test', 'token', undefined, 1000);
    const assertion = expect(promise).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('timed out'),
    });

    jest.advanceTimersByTime(1000);
    await assertion;
  });

  it('rejects with an ApiError instance specifically, not a raw DOMException', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url: string, options?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }) as unknown as typeof fetch;

    const promise = apiRequest('/test', 'token', undefined, 500);
    jest.advanceTimersByTime(500);

    await expect(promise).rejects.toBeInstanceOf(ApiError);
  });

  it('resolves normally when fetch completes before the timeout (happy path unaffected)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ foo: 'bar' }),
    }) as unknown as typeof fetch;

    const result = await apiRequest<{ foo: string }>('/test', 'token', undefined, 20_000);
    expect(result).toEqual({ foo: 'bar' });
  });

  it('propagates a genuine (non-abort) fetch rejection unchanged', async () => {
    const networkError = new Error('network down');
    global.fetch = jest.fn().mockRejectedValue(networkError) as unknown as typeof fetch;

    await expect(apiRequest('/test', 'token')).rejects.toBe(networkError);
  });

  it('does not leave a pending timer after a successful response (no dangling abort)', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
    }) as unknown as typeof fetch;

    await apiRequest('/test', 'token', undefined, 1000);

    // If the timeout weren't cleared, advancing past it would call
    // controller.abort() on an already-settled request — harmless in
    // practice, but this asserts the clearTimeout path actually runs by
    // checking no abort-triggered rejection surfaces after the fact.
    expect(jest.getTimerCount()).toBe(0);
  });
});
