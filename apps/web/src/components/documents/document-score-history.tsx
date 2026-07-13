import type { DocumentScoreHistoryPoint } from '@sph/types';
import { TrendChart } from '@/components/dashboard/trend-chart';
import { EmptyState } from '@/components/ui/query-state';

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function DocumentScoreHistory({ points }: { points: DocumentScoreHistoryPoint[] }): JSX.Element {
  if (points.length === 0) {
    return <EmptyState label="No scan history yet." />;
  }

  return (
    <div className="space-y-4">
      <TrendChart
        title="Score over time"
        points={points.map((point) => ({ label: formatShortDate(point.calculatedAt), value: point.score }))}
        emptyLabel="Not enough scan history yet."
      />
      <ul className="space-y-1 text-sm text-slate-600">
        {[...points].reverse().map((point) => (
          <li key={point.calculatedAt} className="flex justify-between border-b border-slate-100 py-1">
            <span>{new Date(point.calculatedAt).toLocaleString()}</span>
            <span className="font-medium text-slate-900">
              {point.score}/100 &middot; {point.band}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
