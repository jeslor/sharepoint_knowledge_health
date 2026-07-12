'use client';

import type { ReactNode } from 'react';
import { AuthenticatedTemplate, UnauthenticatedTemplate } from '@azure/msal-react';
import { SignInButton } from './sign-in-button';

/**
 * Gates dashboard content behind sign-in. Unauthenticated visitors see a
 * sign-in prompt instead of the protected content — the actual data
 * protection is enforced server-side by apps/api's guard chain regardless;
 * this is the UX-level gate, not the security boundary.
 */
export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  return (
    <>
      <AuthenticatedTemplate>{children}</AuthenticatedTemplate>
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
