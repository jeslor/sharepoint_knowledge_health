'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { AuthGate } from '@/components/auth/auth-gate';
import { SignOutButton } from '@/components/auth/sign-out-button';

export default function DashboardLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <AuthGate>
      <div className="min-h-screen bg-slate-50">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <nav className="flex items-center gap-6 text-sm font-medium text-slate-600">
            <Link href="/dashboard" className="text-slate-900">
              Overview
            </Link>
            <Link href="/dashboard/documents">Documents</Link>
            <Link href="/dashboard/scans">Scans</Link>
            <Link href="/dashboard/governance">Governance</Link>
          </nav>
          <SignOutButton />
        </header>
        <main className="p-6">{children}</main>
      </div>
    </AuthGate>
  );
}
