import type { HealthSummaryResponse } from '@sph/types';

function Card({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function formatScanStatus(status: string | null): string {
  if (!status) return 'Never run';
  return status;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}

export function OverviewCards({ summary }: { summary: HealthSummaryResponse }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card label="Total documents scanned" value={String(summary.totalDocumentsScanned)} />
      <Card label="Average health score" value={summary.averageHealthScore === null ? '—' : `${summary.averageHealthScore}/100`} />
      <Card label="Critical issues" value={String(summary.criticalIssuesCount)} />
      <Card label="Warning issues" value={String(summary.warningIssuesCount)} />
      <Card label="Last successful scan" value={formatTimestamp(summary.lastSuccessfulScanAt)} />
      <Card label="Current scan status" value={formatScanStatus(summary.currentScanStatus)} />
    </div>
  );
}
