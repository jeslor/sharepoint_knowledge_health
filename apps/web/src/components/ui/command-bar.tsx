import type { ReactNode } from 'react';

// Phase 10A.4/10B.3 (plan Part 3.5/3.7): a page's secondary/grouped actions
// row (and, for list pages, the leading search/filter controls per Part
// 3.7) — composes existing Buttons/Inputs/Selects, no new interaction
// logic of its own. 10B.3: a slightly elevated, rounded-xl toolbar surface
// (Layer 1 — border + a hint of background tint, no shadow, consistent
// with every other static surface in the app) instead of a plain
// underlined row, so filter/action controls read as one cohesive bar
// rather than loose, individually-bordered controls sitting on the canvas.
export function CommandBar({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200/60 bg-slate-50/60 p-4">{children}</div>
  );
}
