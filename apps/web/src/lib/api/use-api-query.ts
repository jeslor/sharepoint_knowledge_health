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
  /**
   * True only before the very first fetch (success or failure) has ever
   * resolved for the current deps. Gates initial-paint skeletons — once any
   * data has ever loaded, this never becomes true again, even during a
   * background refetch/poll. This is a narrowing of this field's previous
   * behavior (it used to also flip true on every refetch); every existing
   * consumer already only used it to guard a first-paint skeleton, so this
   * is a bug fix, not a breaking change in practice.
   */
  loading: boolean;
  /**
   * True while a fetch is in flight *and* data from a previous successful
   * fetch is already being shown — a background refresh (post-mutation
   * reload, or a poll tick), not a first load. For a subtle, non-blocking
   * indicator only (e.g. a small spinner) — never gate hiding/replacing
   * already-rendered content on this, or the exact layout-jump/flicker bug
   * this field was introduced to fix comes right back.
   */
  isRefetching: boolean;
  refetch: () => void;
}

/**
 * The one shared data-fetching hook every dashboard view is built on
 * (frontend-rules.md's loading/error/empty-state requirement), instead of
 * pulling in a data-fetching library. Guards against the exact race a
 * hand-rolled per-component useEffect fetch is prone to: if deps change
 * again before a request resolves, the stale response is ignored rather
 * than overwriting fresher state.
 *
 * Root cause fix (2026-07-25): this hook used to expose a single `loading`
 * flag set true on *every* fetch, including a background refetch/poll while
 * good data was already on screen. Every consumer renders
 * `{loading && <LoadingState/>}` alongside `{data && <RealContent/>}` as
 * independent (non-exclusive) conditions — since `data` persists across a
 * refetch, both rendered simultaneously, stacking a loading skeleton above
 * still-fully-rendered content on every mutation-triggered reload and every
 * poll tick (the site-approval layout jump and the scan-list poll flicker
 * both traced back to exactly this). `loading` now only ever reflects the
 * pre-first-load case; `isRefetching` is the new, separate signal for a
 * background refresh, so a consumer that wants a subtle "still fresh, just
 * checking" indicator has one, without it ever being confused for "hide the
 * content."
 */
export function useApiQuery<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  options: UseApiQueryOptions = {},
): UseApiQueryResult<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [isFetching, setIsFetching] = useState(true);
  const [tick, setTick] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refetch = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    if (options.enabled === false) {
      setIsFetching(false);
      return;
    }

    let cancelled = false;
    setIsFetching(true);
    setError(undefined);

    fetcherRef
      .current()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setIsFetching(false);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught : new Error(String(caught)));
          setIsFetching(false);
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

  const loading = isFetching && data === undefined;
  const isRefetching = isFetching && data !== undefined;

  return { data, error, loading, isRefetching, refetch };
}
