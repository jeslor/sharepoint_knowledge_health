'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AuthenticatedTemplate, UnauthenticatedTemplate } from '@azure/msal-react';
import { SignInButton } from './sign-in-button';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { ApiError } from '@/lib/api/client';

/**
 * Root cause fix (2026-07-21): GET /auth/me can 403 for a genuinely
 * signed-in user in two distinct ways (TenantContextGuard) — "Organization
 * not connected" (no MicrosoftTenant bootstrap ever happened for this
 * identity) and "Account pending approval" (a real, already-connected
 * organization, just awaiting an Admin's approval). Before this fix,
 * CurrentUserProvider captured this error but nothing ever acted on it —
 * an authenticated-but-unprovisioned user fell straight through to
 * dashboard content that depends on `user` being defined, rendering a
 * permanently blank skeleton with no path to recovery, regardless of
 * *why* they ended up unprovisioned (a lost onboarding-flow marker, a
 * stale bookmark, direct navigation — any upstream cause). This is the
 * actual backstop: whatever got a signed-in user here without a resolvable
 * organization, they are never left staring at a dead end.
 */
function AuthenticatedGate({ children }: { children: ReactNode }): JSX.Element | null {
  const router = useRouter();
  const { loading, error } = useCurrentUser();

  const notConnected = error instanceof ApiError && error.status === 403 && error.message === 'Organization not connected';
  const pendingApproval = error instanceof ApiError && error.status === 403 && error.message === 'Account pending approval';

  useEffect(() => {
    // Only the "no organization at all" case sends the user back to
    // reconnect — a pending-approval user already has a real organization;
    // sending them through /connect again would be pointless (at best a
    // harmless no-op once resolveOrProvisionFromConsent re-resolves the
    // same 'provisioned-pending' outcome), not a fix for anything.
    if (notConnected) {
      router.replace('/connect');
    }
  }, [notConnected, router]);

  if (loading || notConnected) return null;

  if (pendingApproval) {
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

  return <>{children}</>;
}

/**
 * Gates dashboard content behind sign-in. Unauthenticated visitors see a
 * sign-in prompt instead of the protected content — the actual data
 * protection is enforced server-side by apps/api's guard chain regardless;
 * this is the UX-level gate, not the security boundary.
 */
export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  return (
    <>
      <AuthenticatedTemplate>
        <AuthenticatedGate>{children}</AuthenticatedGate>
      </AuthenticatedTemplate>
      <UnauthenticatedTemplate>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8">
          <h1 className="text-2xl font-semibold text-slate-900">Sign in required</h1>
          <p className="text-slate-600">Sign in with your organization&apos;s Microsoft account to view the dashboard.</p>
          <SignInButton />
        </main>
      </UnauthenticatedTemplate>
    </>
  );
}
