import type { GovernanceSummaryResponse } from '@sph/types';

function Card({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export function GovernanceSummaryCards({ summary }: { summary: GovernanceSummaryResponse }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <Card label="Open issues" value={String(summary.openCount)} />
      <Card label="In progress" value={String(summary.inProgressCount)} />
      <Card label="Resolved" value={String(summary.resolvedCount)} />
      <Card label="Critical issues" value={String(summary.criticalCount)} />
      <Card label="Assigned issues" value={String(summary.assignedCount)} />
    </div>
  );
}
