'use client';

import { OverviewCards } from '@/components/dashboard/overview-cards';
import { LoadingState, ErrorState } from '@/components/ui/query-state';
import { useHealthSummary } from '@/lib/api/hooks/use-health-summary';

export default function DashboardPage(): JSX.Element {
  const { data, loading, error } = useHealthSummary();

  if (loading) return <LoadingState label="Loading organization overview…" />;
  if (error) return <ErrorState error={error} />;
  if (!data) return <LoadingState />;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Organization overview</h1>
      <OverviewCards summary={data} />
    </div>
  );
}
