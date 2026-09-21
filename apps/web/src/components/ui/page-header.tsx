import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  // Single primary action, right-aligned. A page needing more than one
  // action composes ui/command-bar.tsx below this instead.
  action?: ReactNode;
}

// Phase 10A.4 (plan Part 3.5): the top of the standard page-architecture
// pattern — Breadcrumbs → PageHeader → CommandBar → Tabs → content.
//
// Mobile fix: a fixed flex-row put the action (a button or link) beside the
// title unconditionally, so a real title+action pair had nowhere to go but
// to collide or push the action off-screen once the title's own line ran
// out of room. Stacking below sm: (title/description, then the action)
// costs nothing on desktop, where sm:flex-row restores the original row.
export function PageHeader({ title, description, action }: PageHeaderProps): JSX.Element {
  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-page-title text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-body text-slate-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
