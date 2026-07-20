'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AuthGate } from '@/components/auth/auth-gate';
import { AppHeader } from '@/components/dashboard/app-header';
import { DashboardNav } from '@/components/dashboard/dashboard-nav';

export default function DashboardLayout({ children }: { children: ReactNode }): JSX.Element {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();

  return (
    <AuthGate>
      {/* Phase 10A.3 (visual-review fix): a fixed-height flex shell instead
          of a page that scrolls as a whole — the header and sidebar stay in
          place (so a taller nav list, e.g. more icons later, never pushes
          the header off-screen), and only the main content column scrolls. */}
      <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
        <AppHeader mobileNavOpen={mobileNavOpen} onToggleMobileNav={() => setMobileNavOpen((open) => !open)} />
        <div className="flex flex-1 overflow-hidden">
          <DashboardNav mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
          {/* overflow-x-hidden: never a horizontal scrollbar in the shell —
              vertical scrolling only, confined to here and the sidebar. */}
          <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-6 sm:p-8">
            {/* Phase 10A.3: keyed by pathname so this div remounts (and the
                entrance animation replays) on every navigation — no Next.js
                transition API needed. */}
            <div key={pathname} className="animate-fade-in-up space-y-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </AuthGate>
  );
}
