'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { SignInButton } from '@/components/auth/sign-in-button';
import { isConnectFlowInProgress } from '@/lib/auth/connect-flow';

/**
 * This is the registered Entra redirect URI (the app's origin) — Microsoft
 * lands here after a successful sign-in. Auto-navigating an authenticated
 * visitor to /dashboard here, via client-side routing (router.replace, not
 * a full page reload / <a> link), is what actually matters: a full reload
 * would remount <MsalProvider> from scratch and re-read sessionStorage,
 * which works but is slower and was the source of an intermittent "signed
 * in, but /dashboard still shows the sign-in prompt" race when navigated
 * to manually. Client-side routing preserves the exact in-memory MSAL
 * state <MsalProvider> just finished populating from the redirect result,
 * with nothing in between to lose it.
 *
 * Phase 6: this is also where MSAL's own redirect lands after the "Connect
 * Microsoft 365" flow's sign-in step (NEXT_PUBLIC_REDIRECT_URI = the app
 * origin) — a user who just came from that flow isn't bootstrapped into an
 * Organization yet, so must be routed to /connect/finishing instead of
 * straight to /dashboard (which would otherwise 403 "Organization not
 * connected"). isConnectFlowInProgress() checks a sessionStorage marker set
 * only by /connect's entry page — absent for every existing/returning
 * user, so their redirect target is completely unchanged.
 */
export default function HomePage(): JSX.Element {
  const router = useRouter();
  const { inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();

  useEffect(() => {
    if (isAuthenticated && inProgress === InteractionStatus.None) {
      router.replace(isConnectFlowInProgress() ? '/connect/finishing' : '/dashboard');
    }
  }, [isAuthenticated, inProgress, router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8">
      <h1 className="text-3xl font-semibold text-slate-900">SharePoint Knowledge Health</h1>
      <p className="text-slate-600">Measure and improve Microsoft 365 knowledge quality.</p>
      {!isAuthenticated && inProgress === InteractionStatus.None && <SignInButton />}
    </main>
  );
}
