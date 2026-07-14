import type { AnalyticsBucket } from '@sph/types';

interface AnalyticsBarChartProps {
  title: string;
  buckets: AnalyticsBucket[];
}

// Dependency-free, matching TrendChart's precedent (apps/web/src/components/dashboard/trend-chart.tsx)
// — categorical label+count data doesn't fit a line chart, so this is a
// small proportional-width bar list instead, not a new charting library.
export function AnalyticsBarChart({ title, buckets }: AnalyticsBarChartProps): JSX.Element {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);

  if (total === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-700">{title}</p>
        <p className="mt-2 text-sm text-slate-500">No data yet.</p>
      </div>
    );
  }

  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <ul className="mt-3 space-y-2">
        {buckets.map((bucket) => (
          <li key={bucket.label} className="flex items-center gap-2 text-sm">
            <span className="w-28 shrink-0 truncate text-slate-600">{bucket.label}</span>
            <div className="h-4 flex-1 rounded bg-slate-100">
              <div
                className="h-4 rounded bg-slate-900"
                style={{ width: `${Math.max((bucket.count / max) * 100, bucket.count > 0 ? 4 : 0)}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right font-medium text-slate-900">{bucket.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
