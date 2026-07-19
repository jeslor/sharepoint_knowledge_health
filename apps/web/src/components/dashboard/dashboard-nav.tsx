'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  HomeRegular,
  HomeFilled,
  DocumentMultipleRegular,
  DocumentMultipleFilled,
  ScanObjectRegular,
  ScanObjectFilled,
  ShieldRegular,
  ShieldFilled,
  PeopleRegular,
  PeopleFilled,
  BuildingRegular,
  BuildingFilled,
  ChevronDownRegular,
  type FluentIcon,
} from '@fluentui/react-icons';
import { useCurrentUser } from '@/lib/auth/current-user-context';

interface NavLink {
  href: string;
  label: string;
  icon: FluentIcon;
  activeIcon: FluentIcon;
}

interface NavGroup {
  id: string;
  label: string;
  links: NavLink[];
  adminOnly?: boolean;
}

const GROUPS: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    links: [
      { href: '/dashboard', label: 'Overview', icon: HomeRegular, activeIcon: HomeFilled },
      { href: '/dashboard/documents', label: 'Documents', icon: DocumentMultipleRegular, activeIcon: DocumentMultipleFilled },
      { href: '/dashboard/scans', label: 'Scans', icon: ScanObjectRegular, activeIcon: ScanObjectFilled },
      { href: '/dashboard/governance', label: 'Governance', icon: ShieldRegular, activeIcon: ShieldFilled },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    // Sites and Users are Admin-only pages (SharePointSitesController's
    // mutations and UsersController entirely) — the whole group is hidden
    // for other roles rather than left reachable only to land on an
    // access-denied message.
    adminOnly: true,
    links: [
      { href: '/dashboard/sharepoint', label: 'Sites', icon: BuildingRegular, activeIcon: BuildingFilled },
      { href: '/dashboard/users', label: 'Users', icon: PeopleRegular, activeIcon: PeopleFilled },
    ],
  },
];

// '/dashboard' itself must match exactly (otherwise it would also "match"
// every other section, since they're all nested under it); every other
// link matches its own path and any of its sub-routes.
function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface NavGroupsProps {
  groups: NavGroup[];
  pathname: string;
  expanded: Record<string, boolean>;
  onToggleGroup: (id: string) => void;
  onNavigate?: () => void;
}

// Grouped, collapsible sections — the Azure/Purview/Entra sidebar pattern
// (Phase 10A.3) — rather than one flat list.
function NavGroups({ groups, pathname, expanded, onToggleGroup, onNavigate }: NavGroupsProps): JSX.Element {
  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const isExpanded = expanded[group.id] ?? true;
        return (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => onToggleGroup(group.id)}
              aria-expanded={isExpanded}
              className="flex w-full items-center justify-between rounded px-3 py-1 text-caption font-medium uppercase tracking-wider text-slate-400 transition-colors duration-150 ease-premium hover:text-slate-600"
            >
              {group.label}
              <ChevronDownRegular
                fontSize={14}
                className={`transition-transform duration-150 ease-premium ${isExpanded ? '' : '-rotate-90'}`}
              />
            </button>
            {isExpanded && (
              <ul className="mt-1.5 space-y-0.5">
                {group.links.map((link) => {
                  const active = isActive(pathname, link.href);
                  const Icon = active ? link.activeIcon : link.icon;
                  return (
                    <li key={link.href}>
                      {/* Phase 10A.6 (plan Part 2 §4): a full soft filled
                          rounded-rect for the active state, not a left
                          border + tint — the specific change that reads
                          as "considered" rather than "bordered." */}
                      <Link
                        href={link.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-body-strong transition-colors duration-150 ease-premium ${
                          active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                      >
                        <Icon fontSize={20} />
                        {link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface DashboardNavProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

// Left sidebar (desktop, Azure/Entra/Purview-informed layout pattern, ~240px
// fixed width) + off-canvas drawer (mobile) — replaces the horizontal tab
// row from Phase 10A. See plan Part 2's tradeoff evaluation.
export function DashboardNav({ mobileOpen, onCloseMobile }: DashboardNavProps): JSX.Element {
  const { user } = useCurrentUser();
  const isAdmin = user?.role === 'Admin';
  const pathname = usePathname();
  const groups = GROUPS.filter((group) => !group.adminOnly || isAdmin);

  // Both groups start expanded; per-session only (2 groups doesn't warrant
  // persistence). Shared between the desktop sidebar and mobile drawer so
  // collapsing a group is consistent across both.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleGroup = (id: string): void => setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCloseMobile();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen, onCloseMobile]);

  return (
    <>
      {/* overflow-y-auto: the sidebar itself scrolls internally if its
          content ever exceeds viewport height (e.g. more groups/icons
          added later) — it never causes the header or main content to move.
          overflow-x-hidden: never a horizontal scrollbar. */}
      <aside className="hidden w-60 shrink-0 overflow-x-hidden overflow-y-auto border-r border-slate-200/60 bg-white p-4 sm:block">
        <NavGroups groups={groups} pathname={pathname} expanded={expanded} onToggleGroup={toggleGroup} />
      </aside>

      {/* Always mounted (Phase 10A.3) so slide-in-left/fade-in can actually
          play — visibility toggled via transform/opacity/pointer-events +
          aria-hidden, not conditional mounting. */}
      <div className={`fixed inset-0 z-30 sm:hidden ${mobileOpen ? '' : 'pointer-events-none'}`} aria-hidden={!mobileOpen}>
        <div
          className={`fixed inset-0 bg-slate-900/30 transition-opacity duration-150 ease-premium ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={onCloseMobile}
        />
        <nav
          aria-label="Main navigation"
          className={`fixed inset-y-0 left-0 w-64 overflow-y-auto border-r border-slate-200/60 bg-white p-4 shadow-md transition-transform duration-200 ease-premium ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <NavGroups groups={groups} pathname={pathname} expanded={expanded} onToggleGroup={toggleGroup} onNavigate={onCloseMobile} />
        </nav>
      </div>
    </>
  );
}
