import type { OwnershipCoverageBucket } from '@sph/types';
import { Card } from '@/components/ui/card';

// Same layered-surface Card + metric-tile shape as GovernanceSummaryCards
// (Phase 10B.4 precedent) — a new component, not a reuse of that one
// directly, since its tiles are hardcoded to GovernanceSummaryResponse's
// specific fields.
function MetricTile({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <Card>
      <p className="text-caption text-slate-500">{label}</p>
      <p className="mt-1 text-metric text-slate-900">{value}</p>
    </Card>
  );
}

// ADR-0024 §3.2/§5: coveragePercentage is null (never 0) whenever
// scoredDocuments is 0 — rendered here as "Not yet scored" text, never a
// misleading "0%".
export function OwnershipSummaryCards({ bucket }: { bucket: OwnershipCoverageBucket }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <MetricTile label="Total documents" value={String(bucket.totalDocuments)} />
      <MetricTile
        label="Ownership coverage"
        value={bucket.coveragePercentage === null ? 'Not yet scored' : `${bucket.coveragePercentage}%`}
      />
      <MetricTile label="No identifiable owner" value={String(bucket.noIdentifiableOwner)} />
      <MetricTile label="All owners deactivated" value={String(bucket.allOwnersInactive)} />
      <MetricTile label="Not yet scored" value={String(bucket.notYetScored)} />
    </div>
  );
}
