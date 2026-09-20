'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/auth/msal-config';
import { readConnectFlowTenantName, validateConnectFlowState } from '@/lib/auth/connect-flow';
import { AuthShell } from '@/components/auth/auth-shell';
import { MicrosoftLogo } from '@/components/auth/microsoft-logo';
import { Button } from '@/components/ui/button';

/**
 * New, dedicated redirect URI target for Microsoft's raw admin-consent
 * endpoint (registered separately from NEXT_PUBLIC_REDIRECT_URI — see
 * connect-flow.ts's adminConsentRedirectUri()). Deliberately not
 * MSAL-mediated: this query string (?tenant=&admin_consent=&state= or
 * ?error=&error_description=) is not something handleRedirectPromise()
 * recognizes, so this page parses it by hand rather than routing through
 * MSAL at all.
 *
 * SSR/hydration fix (2026-07-22): this page is server-rendered on every
 * request (Next.js App Router SSRs Client Components for the initial
 * HTML). `state`/`adminConsent` come from the request's real query string,
 * so those are safe to read during that server render — but
 * validateConnectFlowState() reads sessionStorage, which does not exist on
 * the server, so stateValid is only ever resolved in an effect (client-
 * only), never in the render body. Server and the client's first paint
 * both render the same thing (the `stateValid === null` case below) before
 * this resolves for real.
 *
 * Tenant-name-carrying fix (2026-07-22): this page used to rely on
 * sessionStorage (sph:connect:tenantName) surviving the *next* redirect —
 * the actual MSAL sign-in round trip through login.microsoftonline.com —
 * for app/page.tsx to later read the tenant name back out. Live testing
 * showed that hop losing the value intermittently (unlike this page's own
 * state-validation read, which reliably works every time, since it never
 * has to survive a redirect at all). The tenant name is now embedded
 * directly in loginRedirect's own `state` parameter — the OAuth protocol's
 * dedicated, reliably-round-tripped channel for this — read on the other
 * side via msal-instance.ts's consumeLastLoginState(), not sessionStorage.
 */
function AdminConsentCallbackContent(): JSX.Element | null {
  const searchParams = useSearchParams();
  const { instance } = useMsal();

  const adminConsent = searchParams.get('admin_consent');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  const succeeded = adminConsent === 'True' && !error;

  const [stateValid, setStateValid] = useState<boolean | null>(null);

  useEffect(() => {
    setStateValid(succeeded && !!state && validateConnectFlowState(state));
  }, [succeeded, state]);

  if (succeeded) {
    // Resolving client-side — render nothing rather than guess, so the
    // server's HTML and the client's first paint always agree.
    if (stateValid === null) return null;

    if (stateValid) {
      return (
        <AuthShell>
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50">
              <MicrosoftLogo className="h-6 w-6" />
            </span>
            <h1 className="text-page-title text-slate-900">Permission granted</h1>
            <p className="max-w-sm text-body text-slate-600">
              Microsoft 365 admin consent was granted successfully. Sign in to confirm your identity
              and finish connecting your organization.
            </p>
          </div>
          <Button
            onClick={() => {
              const tenantName = readConnectFlowTenantName() ?? '';
              const connectState = JSON.stringify({ kind: 'connect', tenantName });
              void instance.loginRedirect({ ...loginRequest, state: connectState });
            }}
            className="w-full justify-center"
          >
            Continue to sign-in
          </Button>
        </AuthShell>
      );
    }

    // Missing/mismatched state — replay, tampered link, or a stale browser
    // history entry from an already-completed flow (§5 failure scenario 5:
    // the sessionStorage entry is only cleared once the whole flow reaches
    // a terminal outcome, so a genuinely fresh revisit after completion
    // correctly lands here too).
    return (
      <AuthShell>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50">
            <MicrosoftLogo className="h-6 w-6" />
          </span>
          <h1 className="text-page-title text-slate-900">This link has expired</h1>
          <p className="max-w-sm text-body text-slate-600">
            We couldn&apos;t verify this connection request. Please start again.
          </p>
          <a href="/connect" className="text-body-strong text-brand-600 underline hover:text-brand-700">
            Start again
          </a>
        </div>
      </AuthShell>
    );
  }

  // Error branch. One named exception (access_denied — the standard,
  // extremely common "user clicked Cancel" code) gets cancellation-specific
  // copy; every other Microsoft error code shares one generic renderer
  // rather than a per-code switch (ADR-0012: inherit Microsoft's own
  // privilege-check decision, don't try to duplicate or enumerate it).
  if (error === 'access_denied') {
    return (
      <AuthShell>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50">
            <MicrosoftLogo className="h-6 w-6" />
          </span>
          <h1 className="text-page-title text-slate-900">You cancelled the connection</h1>
          <p className="max-w-sm text-body text-slate-600">{errorDescription || 'No changes were made.'}</p>
          <a href="/connect" className="text-body-strong text-brand-600 underline hover:text-brand-700">
            Try again
          </a>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50">
          <MicrosoftLogo className="h-6 w-6" />
        </span>
        <h1 className="text-page-title text-slate-900">Admin consent could not be completed</h1>
        <p className="max-w-sm text-body text-slate-600">
          {errorDescription ||
            'You may need Global Administrator privileges in your Microsoft 365 tenant to complete this step.'}
        </p>
        <a href="/connect" className="text-body-strong text-brand-600 underline hover:text-brand-700">
          Try again
        </a>
      </div>
    </AuthShell>
  );
}

export default function AdminConsentCallbackPage(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <AdminConsentCallbackContent />
    </Suspense>
  );
}
