import { DocumentSearchRegular, ErrorCircleFilled } from '@fluentui/react-icons';

/**
 * Shared loading/error/empty rendering for every useApiQuery-backed view
 * (frontend-rules.md: "Always handle loading states. Handle error states.
 * Handle empty states."). One place for this instead of repeating the same
 * three branches in every page/component.
 */

export type LoadingVariant = 'block' | 'card' | 'table-rows';

interface LoadingStateProps {
  label?: string;
  variant?: LoadingVariant;
  // Only meaningful for variant="table-rows" — how many skeleton rows to render.
  rows?: number;
}

// Phase 10A.3/10A.6: a moving-gradient shimmer sweep (pure Tailwind —
// gradient background + the `shimmer` background-position keyframe from
// tailwind.config.ts — zero dependency). 10A.6 widens/softens the sweep
// (wider highlight band, softer via-color) for a smoother, less
// hard-edged pass. `label` remains for a visually hidden accessible name
// so screen readers still announce the loading state's purpose.
const SHIMMER_BLOCK = 'animate-shimmer rounded-md bg-gradient-to-r from-slate-200 via-slate-50 to-slate-200 bg-[length:250%_100%]';

export function LoadingState({ label = 'Loading…', variant = 'block', rows = 3 }: LoadingStateProps): JSX.Element {
  if (variant === 'card') {
    return (
      <div role="status" aria-label={label} className="rounded-xl border border-slate-200/60 bg-white p-6 shadow-card">
        <div className={`h-3 w-24 ${SHIMMER_BLOCK}`} />
        <div className={`mt-3 h-7 w-16 ${SHIMMER_BLOCK}`} />
      </div>
    );
  }

  if (variant === 'table-rows') {
    return (
      <div role="status" aria-label={label} className="space-y-2 p-4">
        {/* A slight stagger (Phase 10A.6) — each row's shimmer starts a
            little after the previous one, a small choreography touch
            instead of every row animating in unison. */}
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className={`h-4 w-full ${SHIMMER_BLOCK}`} style={{ animationDelay: `${index * 60}ms` }} />
        ))}
      </div>
    );
  }

  return (
    <div role="status" aria-label={label} className="space-y-2 p-4">
      <div className={`h-4 w-1/3 ${SHIMMER_BLOCK}`} />
      <div className={`h-4 w-2/3 ${SHIMMER_BLOCK}`} />
    </div>
  );
}

export function ErrorState({ error }: { error: Error }): JSX.Element {
  return (
    <p role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <ErrorCircleFilled fontSize={20} className="shrink-0 text-red-600" />
      {error.message || 'Something went wrong.'}
    </p>
  );
}

interface EmptyStateProps {
  label: string;
  // Optional supporting sentence — Phase 10A.6's two-line composition.
  // Existing call sites keep working unchanged (just `label`, rendered as
  // a bold headline in the icon-badge composition below); pages adopt the
  // second line gradually when they're next touched.
  description?: string;
}

// Phase 10A.6 (plan Part 2 §4): the icon sits in a soft-tinted circular
// badge (matching the KPI-card icon treatment), and the message reads as a
// deliberate small composition rather than one flat gray sentence.
export function EmptyState({ label, description }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
        <DocumentSearchRegular fontSize={24} className="text-slate-400" />
      </span>
      <div className="space-y-1">
        <p className="text-body-strong text-slate-700">{label}</p>
        {description && <p className="text-body text-slate-500">{description}</p>}
      </div>
    </div>
  );
}
