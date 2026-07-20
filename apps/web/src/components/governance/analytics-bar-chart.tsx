import type { AnalyticsBucket } from '@sph/types';
import { Card } from '@/components/ui/card';

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
      <Card>
        <p className="text-body-strong text-slate-700">{title}</p>
        <p className="mt-2 text-body text-slate-500">No data yet.</p>
      </Card>
    );
  }

  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);

  return (
    <Card>
      <p className="text-body-strong text-slate-700">{title}</p>
      <ul className="mt-3 space-y-2">
        {buckets.map((bucket) => (
          <li key={bucket.label} className="flex items-center gap-2 text-sm">
            <span className="w-28 shrink-0 truncate text-slate-600">{bucket.label}</span>
            <div className="h-4 flex-1 rounded-full bg-slate-100">
              <div
                className="h-4 rounded-full bg-brand-600 transition-[width] duration-300 ease-premium"
                style={{ width: `${Math.max((bucket.count / max) * 100, bucket.count > 0 ? 4 : 0)}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right font-medium text-slate-900">{bucket.count}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
