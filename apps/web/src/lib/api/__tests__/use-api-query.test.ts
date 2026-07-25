import { renderHook, waitFor, act } from '@testing-library/react';
import { useApiQuery } from '../use-api-query';

// Root cause regression tests (2026-07-25): loading used to be true on
// *every* fetch, including a background refetch/poll while good data was
// already on screen — every consumer renders {loading && <Skeleton/>}
// alongside {data && <Content/>} as independent conditions, so both used to
// render simultaneously during a refetch (the site-approval layout jump and
// the scan-list poll flicker both traced back to exactly this).
describe('useApiQuery', () => {
  it('reports loading: true and isRefetching: false during the first-ever fetch', async () => {
    let resolveFetch!: (value: string) => void;
    const fetcher = jest.fn(() => new Promise<string>((resolve) => (resolveFetch = resolve)));

    const { result } = renderHook(() => useApiQuery(fetcher, []));

    expect(result.current.loading).toBe(true);
    expect(result.current.isRefetching).toBe(false);
    expect(result.current.data).toBeUndefined();

    await act(async () => {
      resolveFetch('first result');
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe('first result');
  });

  it('reports loading: false and isRefetching: true during a manual refetch, never hiding existing data', async () => {
    const fetcher = jest.fn().mockResolvedValue('initial data');
    const { result } = renderHook(() => useApiQuery(fetcher, []));

    await waitFor(() => expect(result.current.data).toBe('initial data'));
    expect(result.current.loading).toBe(false);

    let resolveRefetch!: (value: string) => void;
    fetcher.mockReturnValue(new Promise<string>((resolve) => (resolveRefetch = resolve)));

    act(() => {
      result.current.refetch();
    });

    // The whole point: data from the previous fetch is still there, loading
    // never flips true again — only isRefetching does.
    expect(result.current.loading).toBe(false);
    expect(result.current.isRefetching).toBe(true);
    expect(result.current.data).toBe('initial data');

    await act(async () => {
      resolveRefetch('refreshed data');
      await Promise.resolve();
    });

    expect(result.current.isRefetching).toBe(false);
    expect(result.current.data).toBe('refreshed data');
  });

  it('reports isRefetching: true (not loading) on each poll tick while data is already loaded', async () => {
    jest.useFakeTimers();
    try {
      const fetcher = jest.fn().mockResolvedValue('polled data');
      const { result } = renderHook(() => useApiQuery(fetcher, [], { pollIntervalMs: 1000 }));

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.data).toBe('polled data');
      expect(fetcher).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
      });

      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toBe('polled data');
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports loading: false and isRefetching: false when a refetch fails, preserving prior data and surfacing the error', async () => {
    const fetcher = jest.fn().mockResolvedValue('good data');
    const { result } = renderHook(() => useApiQuery(fetcher, []));

    await waitFor(() => expect(result.current.data).toBe('good data'));

    fetcher.mockRejectedValueOnce(new Error('refetch failed'));
    await act(async () => {
      result.current.refetch();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.data).toBe('good data'); // stale-but-valid data preserved
    expect(result.current.error?.message).toBe('refetch failed');
    expect(result.current.loading).toBe(false);
    expect(result.current.isRefetching).toBe(false);
  });

  it('never fetches when enabled is false, and reports loading: false', () => {
    const fetcher = jest.fn();
    const { result } = renderHook(() => useApiQuery(fetcher, [], { enabled: false }));

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.isRefetching).toBe(false);
  });
});
