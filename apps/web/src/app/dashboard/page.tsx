'use client';

import { OverviewCards } from '@/components/dashboard/overview-cards';
import { TrendCards } from '@/components/dashboard/trend-cards';
import { TrendChart } from '@/components/dashboard/trend-chart';
import { LoadingState, ErrorState } from '@/components/ui/query-state';
import { useHealthSummary } from '@/lib/api/hooks/use-health-summary';
import { useHealthTrends } from '@/lib/api/hooks/use-health-trends';

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function DashboardPage(): JSX.Element {
  const { data, loading, error } = useHealthSummary();
  const { data: trend, loading: trendLoading, error: trendError } = useHealthTrends();

  if (loading) return <LoadingState label="Loading organization overview…" />;
  if (error) return <ErrorState error={error} />;
  if (!data) return <LoadingState />;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Organization overview</h1>
      <OverviewCards summary={data} />

      <div>
        <h2 className="text-lg font-semibold text-slate-900">Health trends (last 30 days)</h2>
        {trendLoading && <LoadingState label="Loading trends…" />}
        {trendError && <ErrorState error={trendError} />}
        {trend && (
          <div className="mt-4 space-y-4">
            <TrendCards trend={trend} />
            <TrendChart
              title="Average health score"
              points={trend.points
                .filter((point) => point.averageHealthScore !== null)
                .map((point) => ({ label: formatShortDate(point.capturedAt), value: point.averageHealthScore as number }))}
              emptyLabel="Not enough scan history yet."
            />
          </div>
        )}
      </div>
    </div>
  );
}
