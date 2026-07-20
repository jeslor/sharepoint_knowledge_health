'use client';

import { AppsRegular, NavigationRegular, ShieldCheckmarkRegular } from '@fluentui/react-icons';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { Tooltip } from '@/components/ui/tooltip';

interface AppHeaderProps {
  mobileNavOpen: boolean;
  onToggleMobileNav: () => void;
}

// Branded application header — product identity, connected-tenant context,
// and user identity, freed up entirely for this once nav moved to the
// sidebar (Phase 10A.2). This app supports exactly one consented Microsoft
// tenant per organization, so tenantName is shown as a plain label, not a
// switcher. Padding tightened in 10A.3 for a denser admin-console feel.
export function AppHeader({ mobileNavOpen, onToggleMobileNav }: AppHeaderProps): JSX.Element {
  const { user } = useCurrentUser();

  return (
    <header className="flex items-center justify-between border-b border-slate-200/60 bg-white px-4 py-3 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleMobileNav}
          aria-label="Toggle navigation menu"
          aria-expanded={mobileNavOpen}
          className="rounded-md p-1.5 text-slate-600 transition-colors duration-150 ease-premium hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 sm:hidden"
        >
          <NavigationRegular fontSize={20} />
        </button>

        {/* Phase 10A.3/10A.4: a real, functional link back to the tenant's
            actual Microsoft 365 environment (not a decorative app-launcher
            icon — this product isn't part of a real multi-app suite, so a
            fake launcher would be exactly the kind of hollow affordance
            this design system avoids elsewhere). Now uses the polished
            ui/tooltip.tsx primitive (landed in Phase 10A.4); aria-label
            stays on the link itself for screen readers. */}
        <Tooltip content="Open Microsoft 365 admin center">
          <a
            href="https://admin.microsoft.com"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open Microsoft 365 admin center"
            className="hidden rounded-md p-1.5 text-slate-500 transition-colors duration-150 ease-premium hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 sm:block"
          >
            <AppsRegular fontSize={20} />
          </a>
        </Tooltip>

        {/* Phase 10A.7: a small brand logomark — soft-tinted, matching the
            same icon-badge language as CardHeader/EmptyState — gives the
            product a mark of its own instead of reading as bare text next
            to Microsoft's own icon vocabulary. */}
        <div className="flex items-center gap-2.5 border-l border-slate-200/60 pl-3 sm:pl-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-brand-600">
            <ShieldCheckmarkRegular fontSize={16} />
          </span>
          <span className="text-section-title text-slate-900">SharePoint Knowledge Health</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {(user?.tenantName || user?.displayName) && (
          <div className="hidden items-center gap-3 border-r border-slate-200/60 pr-4 sm:flex">
            {/* Breakpoints preserved exactly as before this pass — tenantName
                at md:, displayName at sm: — only the divider around the
                group is new. */}
            {user?.tenantName && <span className="hidden text-caption text-slate-500 md:inline">{user.tenantName}</span>}
            {user?.displayName && <span className="text-body-strong text-slate-900">{user.displayName}</span>}
          </div>
        )}
        <SignOutButton />
      </div>
    </header>
  );
}
