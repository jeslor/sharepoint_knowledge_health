'use client';

import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth/auth-gate';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { DashboardNav } from '@/components/dashboard/dashboard-nav';

export default function DashboardLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <AuthGate>
      <div className="min-h-screen bg-slate-50">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <DashboardNav />
          <SignOutButton />
        </header>
        <main className="p-6">{children}</main>
      </div>
    </AuthGate>
  );
}
