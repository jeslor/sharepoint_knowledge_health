'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useIsAuthenticated } from '@azure/msal-react';
import type { MeResponse } from '@sph/types';
import { getMe } from '@/lib/api/endpoints';
import { useAccessToken } from './use-access-token';

interface CurrentUserContextValue {
  user: MeResponse | undefined;
  loading: boolean;
  error: Error | undefined;
  /**
   * Deterministically re-runs GET /auth/me: the returned promise resolves
   * with the fetched user once context state has already been updated, or
   * rejects if the fetch failed — never a fire-and-forget trigger. This is
   * a local reimplementation, not useApiQuery's own refetch — see ADR/audit
   * note in the PR: useApiQuery is shared by ~20 other call sites that
   * fire-and-forget refetch() today and rely on failures being swallowed
   * internally (never surfacing as a rejection); making that shared refetch
   * awaitable-and-rejecting would turn every one of those into a new
   * unhandled promise rejection. Scoping the fix to this provider avoids
   * that blast radius entirely.
   */
  refetch: () => Promise<MeResponse>;
}

const CurrentUserContext = createContext<CurrentUserContextValue>({
  user: undefined,
  loading: true,
  error: undefined,
  refetch: () => Promise.reject(new Error('useCurrentUser() called outside CurrentUserProvider')),
});

/**
 * Resolves organizationId once per session via the existing GET /auth/me
 * (built in Phase 4) and holds it centrally — every dashboard page needs
 * organizationId, and without this they'd each independently re-fetch it.
 *
 * Root cause fix (2026-07-22): the automatic fetch below fires the instant
 * isAuthenticated flips true — on "/", before the connect flow has even
 * navigated to /connect/finishing, let alone bootstrapped an Organization.
 * That's fine on its own (an optimistic prefetch), but this provider used to
 * have no way to invalidate that first, necessarily-403 result once
 * provisioning actually completed a moment later — the stale error sat here
 * for the rest of the session (isAuthenticated never changes again), and
 * AuthGate read it and bounced a successfully-onboarded user back to
 * /connect. `refetch` is the fix: /connect/finishing now awaits it after a
 * successful consent-callback resolution, before navigating to /dashboard.
 */
export function CurrentUserProvider({ children }: { children: ReactNode }): JSX.Element {
  const isAuthenticated = useIsAuthenticated();
  const getAccessToken = useAccessToken();

  const [user, setUser] = useState<MeResponse>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();

  // getAccessToken's identity churns on nearly every MSAL event (see its own
  // deps: [instance, accounts]) — captured via a ref, mirroring useApiQuery's
  // fetcherRef, so fetchCurrentUser's own identity stays stable and reading
  // it here always uses the latest token-acquisition function.
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;

  // Guards against an in-flight fetch from a stale trigger (an earlier
  // isAuthenticated transition, or a previous manual refetch()) overwriting
  // state with a late-arriving, no-longer-relevant response.
  const generationRef = useRef(0);

  const fetchCurrentUser = useCallback(async (): Promise<MeResponse> => {
    const generation = ++generationRef.current;
    setLoading(true);
    setError(undefined);
    try {
      const token = await getAccessTokenRef.current();
      const result = await getMe(token);
      if (generationRef.current === generation) {
        setUser(result);
        setLoading(false);
      }
      return result;
    } catch (caught) {
      const err = caught instanceof Error ? caught : new Error(String(caught));
      if (generationRef.current === generation) {
        setError(err);
        setLoading(false);
      }
      throw err;
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    // fetchCurrentUser() already records a failure into `error` state itself
    // — this .catch is only here so the automatic, nobody-awaits-this
    // trigger never surfaces as an unhandled promise rejection (unlike the
    // manual refetch() below, whose whole point is to let a caller await
    // and react to the real outcome).
    fetchCurrentUser().catch(() => undefined);
    // Deliberately only [isAuthenticated] — matches the previous
    // deps=[isAuthenticated] behavior exactly; fetchCurrentUser is stable
    // (empty dep array) so there's nothing else meaningful to react to here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  return (
    <CurrentUserContext.Provider value={{ user, loading, error, refetch: fetchCurrentUser }}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser(): CurrentUserContextValue {
  return useContext(CurrentUserContext);
}
