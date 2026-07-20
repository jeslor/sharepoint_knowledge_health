'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/auth/msal-config';
import { validateConnectFlowState } from '@/lib/auth/connect-flow';

/**
 * New, dedicated redirect URI target for Microsoft's raw admin-consent
 * endpoint (registered separately from NEXT_PUBLIC_REDIRECT_URI — see
 * connect-flow.ts's adminConsentRedirectUri()). Deliberately not
 * MSAL-mediated: this query string (?tenant=&admin_consent=&state= or
 * ?error=&error_description=) is not something handleRedirectPromise()
 * recognizes, so this page parses it by hand rather than routing through
 * MSAL at all.
 */
function AdminConsentCallbackContent(): JSX.Element {
  const searchParams = useSearchParams();
  const { instance } = useMsal();

  const adminConsent = searchParams.get('admin_consent');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  const succeeded = adminConsent === 'True' && !error;
  const stateValid = succeeded && !!state && validateConnectFlowState(state);

  if (succeeded && stateValid) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8">
        <h1 className="text-2xl font-semibold text-slate-900">Permission granted</h1>
        <p className="max-w-md text-center text-slate-600">
          Microsoft 365 admin consent was granted successfully. Sign in to confirm your identity
          and finish connecting your organization.
        </p>
        <button
          type="button"
          onClick={() => void instance.loginRedirect(loginRequest)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Continue to sign-in
        </button>
      </main>
    );
  }

  if (succeeded && !stateValid) {
    // Missing/mismatched state — replay, tampered link, or a stale browser
    // history entry from an already-completed flow (§5 failure scenario 5:
    // the sessionStorage entry is only cleared once the whole flow reaches
    // a terminal outcome, so a genuinely fresh revisit after completion
    // correctly lands here too).
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8">
        <h1 className="text-2xl font-semibold text-slate-900">This link has expired</h1>
        <p className="max-w-md text-center text-slate-600">
          We couldn&apos;t verify this connection request. Please start again.
        </p>
        <a href="/connect" className="text-sm font-medium text-slate-900 underline">
          Start again
        </a>
      </main>
    );
  }

  // Error branch. One named exception (access_denied — the standard,
  // extremely common "user clicked Cancel" code) gets cancellation-specific
  // copy; every other Microsoft error code shares one generic renderer
  // rather than a per-code switch (ADR-0012: inherit Microsoft's own
  // privilege-check decision, don't try to duplicate or enumerate it).
  if (error === 'access_denied') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8">
        <h1 className="text-2xl font-semibold text-slate-900">You cancelled the connection</h1>
        <p className="max-w-md text-center text-slate-600">
          {errorDescription || 'No changes were made.'}
        </p>
        <a href="/connect" className="text-sm font-medium text-slate-900 underline">
          Try again
        </a>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8">
      <h1 className="text-2xl font-semibold text-slate-900">Admin consent could not be completed</h1>
      <p className="max-w-md text-center text-slate-600">
        {errorDescription ||
          'You may need Global Administrator privileges in your Microsoft 365 tenant to complete this step.'}
      </p>
      <a href="/connect" className="text-sm font-medium text-slate-900 underline">
        Try again
      </a>
    </main>
  );
}

export default function AdminConsentCallbackPage(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <AdminConsentCallbackContent />
    </Suspense>
  );
}
