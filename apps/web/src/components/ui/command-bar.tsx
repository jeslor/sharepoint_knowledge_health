import type { ReactNode } from 'react';

// Phase 10A.4/10B.3 (plan Part 3.5/3.7): a page's secondary/grouped actions
// row (and, for list pages, the leading search/filter controls per Part
// 3.7) — composes existing Buttons/Inputs/Selects, no new interaction
// logic of its own. 10B.3: a slightly elevated, rounded-xl toolbar surface
// (Layer 1 — border + a hint of background tint, no shadow, consistent
// with every other static surface in the app) instead of a plain
// underlined row, so filter/action controls read as one cohesive bar
// rather than loose, individually-bordered controls sitting on the canvas.
//
// Mobile fix: plain flex-wrap with no per-item width gives every Field its
// intrinsic content width, which on a narrow viewport is nearly the full
// row — three or four filters then stack as three or four full-height
// rows, burning a lot of vertical space before any results are visible.
// A 2-column grid below sm: pairs them up (matching the existing
// Field-per-control shape, no markup changes at call sites) while sm: and
// up keeps the original flex-wrap toolbar layout untouched.
export function CommandBar({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200/60 bg-slate-50/60 p-4 sm:flex sm:flex-wrap sm:items-end sm:gap-4">
      {children}
    </div>
  );
}
