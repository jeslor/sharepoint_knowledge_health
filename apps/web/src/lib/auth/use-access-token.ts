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
 */
export function useAccessToken(): () => Promise<string> {
  const { instance, accounts } = useMsal();

  return useCallback(async () => {
    const account = accounts[0];
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
