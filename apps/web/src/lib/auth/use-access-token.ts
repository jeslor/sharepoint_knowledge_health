'use client';

import { useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { loginRequest } from './msal-config';

/**
 * Returns a function that resolves the current ID token (never the access
 * token — apps/api's EntraJwtGuard validates an ID token shape, see
 * msal-config.ts). Silent acquisition first (MSAL's own cache), falling
 * back to an interactive redirect only when the silent attempt genuinely
 * requires user interaction (expired session, revoked consent, etc.).
 *
 * Root cause fix (2026-07-22): this used to read `accounts[0]` — an
 * arbitrary entry from MSAL's cached-accounts array, not necessarily the
 * account that just completed a fresh interactive login. Once more than one
 * account has ever been cached in this browser (trivially true after
 * repeated onboarding attempts across a debugging session, or any user who
 * has signed into more than one Microsoft identity here), `accounts[0]` can
 * silently resolve to a stale, already-expired account — and
 * acquireTokenSilent happily returns that stale account's unchanged cached
 * ID token instead of erroring, since the account itself is a valid cache
 * entry. Confirmed live: the same exp/iat kept reappearing across repeated
 * fresh "Continue to sign-in" attempts. msalInstance's own event callback
 * already calls setActiveAccount() on every successful login — reading
 * getActiveAccount() here (falling back to accounts[0] only if nothing is
 * active yet, mirroring msal-instance.ts's own bootstrap fallback) is what
 * actually guarantees "the account that just signed in."
 */
export function useAccessToken(): () => Promise<string> {
  const { instance, accounts } = useMsal();

  return useCallback(async () => {
    const account = instance.getActiveAccount() ?? accounts[0];
    if (!account) {
      throw new Error('No authenticated account — sign in first');
    }

    try {
      const result = await instance.acquireTokenSilent({ ...loginRequest, account });
      return result.idToken;
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        await instance.acquireTokenRedirect({ ...loginRequest, account });
      }
      throw error;
    }
  }, [instance, accounts]);
}
