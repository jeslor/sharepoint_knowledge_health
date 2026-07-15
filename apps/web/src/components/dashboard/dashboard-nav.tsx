'use client';

import Link from 'next/link';
import { useCurrentUser } from '@/lib/auth/current-user-context';

export function DashboardNav(): JSX.Element {
  const { user } = useCurrentUser();
  // Sites and Users are Admin-only pages (SharePointSitesController's
  // mutations and UsersController entirely) — hidden here for other roles
  // rather than left reachable only to land on an access-denied message.
  const isAdmin = user?.role === 'Admin';

  return (
    <nav className="flex items-center gap-6 text-sm font-medium text-slate-600">
      <Link href="/dashboard" className="text-slate-900">
        Overview
      </Link>
      <Link href="/dashboard/documents">Documents</Link>
      <Link href="/dashboard/scans">Scans</Link>
      <Link href="/dashboard/governance">Governance</Link>
      {isAdmin && <Link href="/dashboard/sharepoint">Sites</Link>}
      {isAdmin && <Link href="/dashboard/users">Users</Link>}
    </nav>
  );
}
