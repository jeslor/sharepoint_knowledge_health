import type { ReactNode } from 'react';
import Link from 'next/link';
import { Spinner } from './spinner';

export interface JobStatusCardField {
  label: string;
  value: ReactNode;
  // Fields that read as a short list of counts (Total/Succeeded/Failed/…)
  // pair two-per-row; a field expected to run long (Progress, Error) takes
  // the full row instead of being squeezed to half-width.
  fullWidth?: boolean;
}

interface JobStatusCardProps {
  statusBadge: ReactNode;
  // Shows a small spinner next to the status badge for a still-in-flight
  // scan/job — mirrors the desktop table row's own live-indicator.
  active?: boolean;
  fields: JobStatusCardField[];
  viewHref: string;
  viewLabel?: string;
}

// Shared mobile-card shape for ScanList and RemediationJobList — both are
// "a paginated list of background jobs with a status that can still be in
// flight" (RemediationJobList's own comment already called out ScanList as
// its closest precedent), so their card treatment is one component, not
// two near-identical ones.
export function JobStatusCard({
  statusBadge,
  active,
  fields,
  viewHref,
  viewLabel = 'View',
}: JobStatusCardProps): JSX.Element {
  return (
    <div
      className={`rounded-xl border border-slate-200/60 bg-white p-4 shadow-card ${active ? 'bg-brand-50/40' : ''}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2">
          {statusBadge}
          {active && <Spinner className="h-3.5 w-3.5 text-brand-600" />}
        </span>
        <Link href={viewHref} className="text-body-strong text-slate-900 underline">
          {viewLabel}
        </Link>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-slate-100 pt-3 text-body">
        {fields.map((field) => (
          <div key={field.label} className={field.fullWidth ? 'col-span-2' : ''}>
            <dt className="text-caption text-slate-500">{field.label}</dt>
            <dd className="text-slate-700">{field.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
