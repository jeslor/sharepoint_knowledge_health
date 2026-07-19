import type { ReactNode } from 'react';

interface TooltipProps {
  content: string;
  children: ReactNode;
}

// Phase 10A.4 (plan Part 3.6): CSS-only (group-hover/group-focus-within, no
// JS/portal) for the simple fixed-placement cases identified — icon-only
// controls like the app-launcher link, hamburger, toast dismiss. Reserved
// for cases that don't need collision-aware repositioning near a viewport
// edge; those would compose the Fluent primitives already present for
// Dialog/Menu instead.
export function Tooltip({ content, children }: TooltipProps): JSX.Element {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-caption text-white opacity-0 shadow-md transition-opacity duration-150 ease-premium group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}
