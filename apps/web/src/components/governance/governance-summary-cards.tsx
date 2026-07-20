import type { GovernanceSummaryResponse } from '@sph/types';
import { Card } from '@/components/ui/card';

// Phase 10B.4: shares the same layered-surface Card as every other metric
// tile in the app (dashboard hero/KPI cards, ExecutiveSummaryCards) — this
// previously hand-rolled its own pre-10A.6 "border + shadow-sm" box, which
// read as an older, unrelated component next to the rest of the page.
function MetricTile({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <Card>
      <p className="text-caption text-slate-500">{label}</p>
      <p className="mt-1 text-metric text-slate-900">{value}</p>
    </Card>
  );
}

export function GovernanceSummaryCards({ summary }: { summary: GovernanceSummaryResponse }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <MetricTile label="Open issues" value={String(summary.openCount)} />
      <MetricTile label="In progress" value={String(summary.inProgressCount)} />
      <MetricTile label="Resolved" value={String(summary.resolvedCount)} />
      <MetricTile label="Critical issues" value={String(summary.criticalCount)} />
      <MetricTile label="Assigned issues" value={String(summary.assignedCount)} />
    </div>
  );
}
