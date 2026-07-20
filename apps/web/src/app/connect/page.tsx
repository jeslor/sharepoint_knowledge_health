'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { requireClientId } from '@/lib/auth/msal-config';
import { adminConsentRedirectUri, buildAdminConsentUrl, startConnectFlow } from '@/lib/auth/connect-flow';

/**
 * Entry point for a brand-new organization (LAT report F1 / Phase 6 P1).
 * Deliberately outside AuthGate/app/dashboard — there is no organizationId
 * to scope anything under yet. Mirrors app/page.tsx's own
 * isAuthenticated+inProgress redirect pattern for an already-authenticated
 * visitor landing here directly.
 */
export default function ConnectPage(): JSX.Element {
  const router = useRouter();
  const { inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [tenantName, setTenantName] = useState('');

  useEffect(() => {
    if (isAuthenticated && inProgress === InteractionStatus.None) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, inProgress, router]);

  const canConnect = tenantName.trim().length > 0;

  function handleConnect(): void {
    if (!canConnect) return;
    const state = startConnectFlow(tenantName.trim());
    const url = buildAdminConsentUrl(requireClientId(), adminConsentRedirectUri(), state);
    window.location.href = url;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8">
      <h1 className="text-3xl font-semibold text-slate-900">Connect Microsoft 365</h1>
      <p className="max-w-md text-center text-slate-600">
        Connect your organization&apos;s Microsoft 365 tenant. A Global Administrator must
        complete this step.
      </p>
      <div className="flex w-full max-w-sm flex-col gap-2">
        <label htmlFor="tenantName" className="text-sm font-medium text-slate-700">
          Organization name
        </label>
        <input
          id="tenantName"
          type="text"
          value={tenantName}
          onChange={(event) => setTenantName(event.target.value)}
          placeholder="Acme Corporation"
          maxLength={200}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <button
        type="button"
        disabled={!canConnect}
        onClick={handleConnect}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Connect Microsoft 365
      </button>
    </main>
  );
}
