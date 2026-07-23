'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { SignInButton } from '@/components/auth/sign-in-button';
import { consumeLastLoginState } from '@/lib/auth/msal-instance';

interface ConnectLoginState {
  kind: 'connect';
  tenantName: string;
}

function parseConnectLoginState(raw: string | null): ConnectLoginState | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { kind?: unknown }).kind === 'connect' &&
      typeof (parsed as { tenantName?: unknown }).tenantName === 'string'
    ) {
      return parsed as ConnectLoginState;
    }
  } catch {
    // Not our payload — e.g. a plain returning-user sign-in via
    // SignInButton, which passes no custom state at all.
  }
  return null;
}

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
 * connected").
 *
 * Root cause fix (2026-07-22): consumeLastLoginState() reads the tenant
 * name out of MSAL's own `state` parameter (set by admin-consent-
 * callback/page.tsx's loginRedirect call, round-tripped by
 * login.microsoftonline.com as part of the OAuth response itself). It is a
 * mutating read — it clears the value once consumed, so a second call
 * always returns null regardless of what actually happened. This effect
 * had no re-entry guard, and apps/web/next.config.ts sets
 * reactStrictMode: true, which intentionally double-invokes effects with
 * no cleanup function in development. Confirmed via an isolated
 * StrictMode-wrapped render of this exact component: the first invocation
 * correctly consumed the real state and called
 * router.replace('/connect/finishing?...'); Strict Mode's diagnostic
 * second invocation then consumed nothing (already cleared), computed
 * '/dashboard' instead, and called router.replace('/dashboard') — the
 * later call wins, so the browser ended up on /dashboard even though the
 * correct target was computed a moment earlier. consumedRef guards against
 * this: the state is consumed at most once per real authentication event,
 * matching finishing/page.tsx's existing startedRef pattern for the same
 * class of problem.
 */
export default function HomePage(): JSX.Element {
  const router = useRouter();
  const { inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const consumedRef = useRef(false);

  useEffect(() => {
    if (isAuthenticated && inProgress === InteractionStatus.None) {
      if (consumedRef.current) return;
      consumedRef.current = true;

      const connectState = parseConnectLoginState(consumeLastLoginState());
      const target = connectState
        ? `/connect/finishing?tenantName=${encodeURIComponent(connectState.tenantName)}`
        : '/dashboard';
      router.replace(target);
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
