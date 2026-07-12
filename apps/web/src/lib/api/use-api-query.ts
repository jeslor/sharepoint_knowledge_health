'use client';

import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

interface UseApiQueryOptions {
  /** Poll on this interval (ms) in addition to normal dep-driven refetches. Omit to disable polling. */
  pollIntervalMs?: number;
  /** Skip fetching entirely (e.g. waiting on a prerequisite value). */
  enabled?: boolean;
}

interface UseApiQueryResult<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  refetch: () => void;
}

/**
 * The one shared data-fetching hook every dashboard view is built on
 * (frontend-rules.md's loading/error/empty-state requirement), instead of
 * pulling in a data-fetching library. Guards against the exact race a
 * hand-rolled per-component useEffect fetch is prone to: if deps change
 * again before a request resolves, the stale response is ignored rather
 * than overwriting fresher state.
 */
export function useApiQuery<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  options: UseApiQueryOptions = {},
): UseApiQueryResult<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refetch = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    if (options.enabled === false) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);

    fetcherRef
      .current()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught : new Error(String(caught)));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // deps is caller-controlled and intentionally spread — this hook's
    // entire purpose is generic dependency-driven refetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, options.enabled]);

  useEffect(() => {
    if (!options.pollIntervalMs) return undefined;
    const interval = setInterval(refetch, options.pollIntervalMs);
    return () => clearInterval(interval);
  }, [options.pollIntervalMs, refetch]);

  return { data, error, loading, refetch };
}
