import type { GovernanceSummaryResponse } from '@sph/types';
import { Card } from '@/components/ui/card';

// Phase 10B.4: shares the same layered-surface Card as every other metric
// tile in the app — this previously hand-rolled its own pre-10A.6
// "border + shadow-sm" box, which read as an older, unrelated component
// next to the rest of the page.
function MetricTile({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <Card>
      <p className="text-caption text-slate-500">{label}</p>
      <p className="mt-1 text-metric text-slate-900">{value}</p>
    </Card>
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
      <MetricTile label="Open issues" value={String(summary.openCount)} />
      <MetricTile label="Resolved this month" value={String(summary.resolvedThisMonth)} />
      <MetricTile label="Average resolution time" value={formatResolutionTime(summary.averageResolutionTimeHours)} />
      <MetricTile label="Critical issues" value={String(summary.criticalCount)} />
      <MetricTile label="Governance completion rate" value={`${summary.completionRate}%`} />
    </div>
  );
}
