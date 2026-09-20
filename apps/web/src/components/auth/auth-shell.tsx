import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';

/**
 * Shared full-screen frame for every pre-authentication page (/,  /connect,
 * /connect/finishing, /connect/admin-consent-callback) — a soft Microsoft-
 * style gradient backdrop behind a single centered Card, reusing the same
 * `Card` primitive the dashboard already uses (components/ui/card.tsx)
 * rather than a one-off surface just for these four screens. Purely
 * presentational: takes no props beyond the card's own content, so it
 * carries no auth/routing logic of its own.
 */
export function AuthShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 p-4 sm:p-8">
      {/* Soft, static (non-animated) blurred blobs — an ambient Fluent-style
          backdrop, not a decorative animation. Kept behind the card
          (-z-0/pointer-events-none) and low-opacity so it reads as
          enterprise-professional rather than a startup marketing gradient. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-200/40 blur-3xl" />
        <div className="absolute -bottom-32 -right-16 h-[28rem] w-[28rem] rounded-full bg-sky-200/40 blur-3xl" />
        <div className="absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full bg-purple-200/30 blur-3xl" />
      </div>

      <Card className="relative z-10 w-full max-w-md space-y-6">{children}</Card>
    </main>
  );
}
