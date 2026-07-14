import type { GovernanceSummaryResponse } from '@sph/types';

function Card({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function formatResolutionTime(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

// Distinct from GovernanceSummaryCards (Phase 8B's operational
// open/inProgress/resolved/critical/assigned workload view) — these are
// the executive-facing metrics from Phase 8D §3.
export function ExecutiveSummaryCards({ summary }: { summary: GovernanceSummaryResponse }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <Card label="Open issues" value={String(summary.openCount)} />
      <Card label="Resolved this month" value={String(summary.resolvedThisMonth)} />
      <Card label="Average resolution time" value={formatResolutionTime(summary.averageResolutionTimeHours)} />
      <Card label="Critical issues" value={String(summary.criticalCount)} />
      <Card label="Governance completion rate" value={`${summary.completionRate}%`} />
    </div>
  );
}
