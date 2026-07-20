'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import type { ConsentResolution } from '@sph/types';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { discoverSharePointSites, postConsentCallback } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { clearConnectFlow, readConnectFlowTenantName } from '@/lib/auth/connect-flow';

type FinishingState =
  | { status: 'working' }
  | { status: 'provisioned-pending' }
  | { status: 'rejected' }
  | { status: 'error'; message: string };

/**
 * The bootstrap orchestrator (LAT report F1 / Phase 6 P1) — reached only
 * via app/page.tsx's corrected routing once MSAL sign-in (the "Connect
 * Microsoft 365" flow's second step) completes. Calls the existing,
 * unchanged POST /auth/consent-callback exactly once, then routes on the
 * response's `kind` (exhaustively — all 4 ConsentResolution values).
 */
export default function ConnectFinishingPage(): JSX.Element {
  const router = useRouter();
  const { inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const getAccessToken = useAccessToken();
  const [state, setState] = useState<FinishingState>({ status: 'working' });
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || inProgress !== InteractionStatus.None) return;
    // Guard against re-firing (effect deps can change reference without a
    // real state change, e.g. getAccessToken's identity) — this POST must
    // fire exactly once per visit.
    if (startedRef.current) return;
    startedRef.current = true;

    const tenantName = readConnectFlowTenantName();
    if (!tenantName) {
      // Reachable only by directly visiting this URL outside the connect
      // flow (no marker was ever set) — nothing to bootstrap, so just
      // fall back to the normal authenticated destination.
      router.replace('/dashboard');
      return;
    }

    function routeOnResolution(resolution: ConsentResolution): void {
      clearConnectFlow();
      switch (resolution.kind) {
        case 'bootstrapped':
        case 'existing':
          router.replace('/dashboard');
          return;
        case 'provisioned-pending':
          setState({ status: 'provisioned-pending' });
          return;
        case 'rejected':
          setState({ status: 'rejected' });
          return;
        default: {
          // Exhaustiveness check — a new ConsentResolution.kind added later
          // fails typecheck here rather than silently falling through.
          const exhaustive: never = resolution;
          throw new Error(`Unhandled ConsentResolution: ${JSON.stringify(exhaustive)}`);
        }
      }
    }

    void (async () => {
      try {
        const idToken = await getAccessToken();
        const resolution = await postConsentCallback(idToken, tenantName);

        // ADR-0014 §1: discovery is meant to fire automatically the moment a
        // MicrosoftTenant transitions to Consented — 'bootstrapped' is the
        // one resolution kind where that transition just happened (a brand
        // new organization's first Admin, who by construction already has
        // the Admin role the discover-sites endpoint requires). Best-effort:
        // a transient Graph hiccup here must not turn a successful bootstrap
        // into an error page — the Sites page's manual "Discover sites"
        // button remains as a fallback either way.
        if (resolution.kind === 'bootstrapped') {
          try {
            await discoverSharePointSites(resolution.organizationId, idToken);
          } catch {
            // Swallowed deliberately — see comment above.
          }
        }

        routeOnResolution(resolution);
      } catch (caught) {
        clearConnectFlow();
        const message =
          caught instanceof ApiError
            ? caught.message
            : 'Something went wrong while connecting your organization. Please try again.';
        setState({ status: 'error', message });
      }
    })();
  }, [isAuthenticated, inProgress, router, getAccessToken]);

  if (state.status === 'provisioned-pending') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8">
        <h1 className="text-2xl font-semibold text-slate-900">Almost there</h1>
        <p className="max-w-md text-center text-slate-600">
          Your identity was confirmed, but your organization is already connected. An
          administrator needs to approve your account before you can continue.
        </p>
      </main>
    );
  }

  if (state.status === 'rejected') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8">
        <h1 className="text-2xl font-semibold text-slate-900">This tenant hasn&apos;t completed admin consent</h1>
        <p className="max-w-md text-center text-slate-600">
          Your Microsoft 365 tenant needs to complete admin consent before an organization can be
          connected.
        </p>
        <a href="/connect" className="text-sm font-medium text-slate-900 underline">
          Try again
        </a>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8">
        <h1 className="text-2xl font-semibold text-slate-900">Something went wrong</h1>
        <p className="max-w-md text-center text-slate-600">{state.message}</p>
        <a href="/connect" className="text-sm font-medium text-slate-900 underline">
          Try again
        </a>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8">
      <p className="text-slate-600">Finishing setup…</p>
    </main>
  );
}

