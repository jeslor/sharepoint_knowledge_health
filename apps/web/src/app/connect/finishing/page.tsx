'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import type { ConsentResolution, DiscoveryStatusValue } from '@sph/types';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { getOnboardingStatus, postConsentCallback } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { clearConnectFlow } from '@/lib/auth/connect-flow';

type FinishingState =
  | { status: 'working' }
  | { status: 'discovering'; discoveryStatus: DiscoveryStatusValue | null }
  | { status: 'provisioned-pending' }
  | { status: 'rejected' }
  | { status: 'error'; message: string };

// A bounded wait for the common case (small-to-medium tenants finish well
// inside this), never indefinite — this page's job is to show the "we're
// seeing your data" moment when it's fast, not to block onboarding on a
// large tenant's discovery run. Whatever discoveryStatus is when polling
// gives up, the dashboard/Sites page remain the durable source of truth,
// and the existing manual "Discover sites" button is still a fallback.
const DISCOVERY_POLL_INTERVAL_MS = 2000;
const DISCOVERY_POLL_MAX_ATTEMPTS = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The bootstrap orchestrator (LAT report F1 / Phase 6 P1) — reached only
 * via app/page.tsx's corrected routing once MSAL sign-in (the "Connect
 * Microsoft 365" flow's second step) completes. Calls the existing,
 * unchanged POST /auth/consent-callback exactly once, then routes on the
 * response's `kind` (exhaustively — all 4 ConsentResolution values).
 *
 * ADR-0014 amendment / ADR-0017: discovery itself is no longer triggered
 * from this page — the consent-callback bootstrap enqueues it server-side
 * the moment a MicrosoftTenant transitions to Consented. This page's only
 * remaining discovery-related job is purely reactive: poll
 * GET .../onboarding-status and render exactly what it reports — no
 * separate client-side progress model of its own.
 *
 * Root cause fix (2026-07-22): the tenant name used to be read back out of
 * sessionStorage here (set by /connect, expected to survive the MSAL
 * sign-in redirect round trip in between). Live testing showed that
 * specific hop losing the value intermittently. app/page.tsx now passes it
 * through as a query param instead, sourced from MSAL's own `state`
 * parameter (see msal-instance.ts's consumeLastLoginState()) — the OAuth
 * protocol's own reliably-round-tripped channel, not a sessionStorage
 * side-channel with no such guarantee across a cross-origin redirect.
 */
function ConnectFinishingContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
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

    const tenantName = searchParams.get('tenantName');
    if (!tenantName) {
      // Reachable only by directly visiting this URL outside the connect
      // flow (no tenantName param was ever set) — nothing to bootstrap, so
      // just fall back to the normal authenticated destination.
      router.replace('/dashboard');
      return;
    }

    async function pollUntilDiscoveryComplete(organizationId: string, idToken: string): Promise<void> {
      for (let attempt = 0; attempt < DISCOVERY_POLL_MAX_ATTEMPTS; attempt += 1) {
        let discoveryStatus: DiscoveryStatusValue | null;
        try {
          discoveryStatus = (await getOnboardingStatus(organizationId, idToken)).discoveryStatus;
        } catch {
          // A transient status-read failure doesn't block onboarding — stop
          // polling and proceed; the dashboard/Sites page remain the
          // durable source of truth regardless.
          return;
        }

        if (discoveryStatus === 'Completed' || discoveryStatus === 'Failed') return;
        setState({ status: 'discovering', discoveryStatus });
        await sleep(DISCOVERY_POLL_INTERVAL_MS);
      }
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

        // 'bootstrapped' is the one resolution kind where a MicrosoftTenant
        // just transitioned to Consented — the moment discovery was
        // enqueued server-side (ADR-0014 §1 / amendment).
        if (resolution.kind === 'bootstrapped') {
          setState({ status: 'discovering', discoveryStatus: null });
          await pollUntilDiscoveryComplete(resolution.organizationId, idToken);
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
  }, [isAuthenticated, inProgress, router, getAccessToken, searchParams]);

  if (state.status === 'discovering') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8">
        <p className="text-slate-600">
          {state.discoveryStatus === 'Running' ? 'Discovering your SharePoint sites…' : 'Finishing setup…'}
        </p>
      </main>
    );
  }

  if (state.status === 'provisioned-pending') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8">
        <h1 className="text-2xl font-semibold text-slate-900">Almost there</h1>
        <p className="max-w-md text-center text-slate-600">
          Your identity was confirmed, but your organization is already connected. An administrator
          needs to approve your account before you can continue.
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

export default function ConnectFinishingPage(): JSX.Element {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8">
          <p className="text-slate-600">Finishing setup…</p>
        </main>
      }
    >
      <ConnectFinishingContent />
    </Suspense>
  );
}
