import type { HTMLAttributes, ReactNode } from 'react';
import type { FluentIcon } from '@fluentui/react-icons';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  // Phase 10A.3 (Layer 1 depth model, plan Part 3): clickable cards (e.g.
  // dashboard KPI cards with drill-down) get a stronger hover lift to
  // communicate depth — still never a Layer-2-strength shadow, that stays
  // reserved for Menu/Callout/Dialog/Toast.
  interactive?: boolean;
}

// Phase 10A.6 (plan Part 2 §4 — a confirmed, deliberate reversal of 10A.2's
// "no shadow, ever" rule): a soft, tinted, two-layer shadow (`shadow-card`,
// tailwind.config.ts) plus a softened border together read as a layered
// surface rather than a bordered rectangle — still emphatically not the
// pronounced `shadow-md` reserved for Layer 2 floating elements.
export function Card({ interactive = false, className = '', ...props }: CardProps): JSX.Element {
  const interactiveClass = interactive
    ? 'cursor-pointer transition-[box-shadow,transform] duration-150 ease-premium hover:-translate-y-px hover:shadow-card-hover'
    : '';
  return (
    <div
      className={`rounded-xl border border-slate-200/60 bg-white p-6 shadow-card ${interactiveClass} ${className}`}
      {...props}
    />
  );
}

interface CardHeaderProps {
  title: string;
  // "Recognition" icon use case — one per card header, not decorative.
  icon?: FluentIcon;
  action?: ReactNode;
}

// Optional header band — internal hierarchy via a subtle bg-slate-50 tint
// instead of extra elevation. Negative margins match Card's p-6 (10A.6).
export function CardHeader({ title, icon: Icon, action }: CardHeaderProps): JSX.Element {
  return (
    <div className="-mx-6 -mt-6 mb-4 flex items-center justify-between rounded-t-xl border-b border-slate-200/60 bg-slate-50 px-6 py-3.5">
      <div className="flex items-center gap-2.5 text-section-title text-slate-900">
        {/* Phase 10A.7: the same soft-tinted icon-badge language as
            EmptyState/the header logomark — one small, precise, repeated
            use of the accent color rather than scattering it. */}
        {Icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-brand-600">
            <Icon fontSize={16} />
          </span>
        )}
        {title}
      </div>
      {action}
    </div>
  );
}
