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
export function PageHeader({ title, description, action }: PageHeaderProps): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-page-title text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-body text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
