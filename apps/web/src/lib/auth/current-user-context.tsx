'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useIsAuthenticated } from '@azure/msal-react';
import type { MeResponse } from '@sph/types';
import { getMe } from '@/lib/api/endpoints';
import { useApiQuery } from '@/lib/api/use-api-query';
import { useAccessToken } from './use-access-token';

interface CurrentUserContextValue {
  user: MeResponse | undefined;
  loading: boolean;
  error: Error | undefined;
}

const CurrentUserContext = createContext<CurrentUserContextValue>({
  user: undefined,
  loading: true,
  error: undefined,
});

/**
 * Resolves organizationId once per session via the existing GET /auth/me
 * (built in Phase 4) and holds it centrally — every dashboard page needs
 * organizationId, and without this they'd each independently re-fetch it.
 */
export function CurrentUserProvider({ children }: { children: ReactNode }): JSX.Element {
  const isAuthenticated = useIsAuthenticated();
  const getAccessToken = useAccessToken();

  const { data, loading, error } = useApiQuery<MeResponse>(
    async () => {
      const token = await getAccessToken();
      return getMe(token);
    },
    [isAuthenticated],
    { enabled: isAuthenticated },
  );

  return <CurrentUserContext.Provider value={{ user: data, loading, error }}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): CurrentUserContextValue {
  return useContext(CurrentUserContext);
}
