'use client';

import type { ReactNode } from 'react';
import { MsalProvider } from '@azure/msal-react';
import { msalInstance } from '@/lib/auth/msal-instance';
import { CurrentUserProvider } from '@/lib/auth/current-user-context';

/**
 * <MsalProvider> must be rendered unconditionally, immediately — it owns
 * calling PublicClientApplication.initialize() and handleRedirectPromise()
 * itself (see msal-instance.ts). Gating this render on our own async
 * pre-initialization (as an earlier version of this file did) starves
 * MsalProvider of the Startup/HandleRedirect states its own child
 * components rely on to avoid flashing the wrong auth UI.
 */
export function AppProviders({ children }: { children: ReactNode }): JSX.Element {
  return (
    <MsalProvider instance={msalInstance}>
      <CurrentUserProvider>{children}</CurrentUserProvider>
    </MsalProvider>
  );
}
