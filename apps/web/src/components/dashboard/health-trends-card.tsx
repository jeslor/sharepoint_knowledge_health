import type { HealthTrendResponse } from '@sph/types';
import { TrendChart } from './trend-chart';

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function scoreDelta(trend: HealthTrendResponse): { text: string; className: string } | null {
  const scored = trend.points.filter((point) => point.averageHealthScore !== null);
  if (scored.length < 2) return null;
  const current = scored[scored.length - 1];
  const previous = scored[scored.length - 2];
  if (!current || !previous || current.averageHealthScore === null || previous.averageHealthScore === null) return null;
  const delta = current.averageHealthScore - previous.averageHealthScore;
  if (delta === 0) return { text: '— stable', className: 'text-slate-500' };
  const arrow = delta > 0 ? '▲' : '▼';
  return { text: `${arrow} ${delta > 0 ? `+${delta}` : delta} vs previous scan`, className: delta > 0 ? 'text-green-600' : 'text-red-600' };
}

// Phase 10B: explicitly secondary/de-emphasized per the approved plan —
// "minimal grid," not the 8-tile stat wall the old TrendCards component
// used (retired; that pattern is exactly the "colorful analytics tiles
// everywhere" this redesign avoids). Just the chart + the one number that
// actually matters at a glance: is it moving up or down.
export function HealthTrendsCard({ trend }: { trend: HealthTrendResponse }): JSX.Element {
  const delta = scoreDelta(trend);

  return (
    <div className="space-y-3">
      <h2 className="text-section-title text-slate-900">Health trends</h2>
      {delta && <p className={`text-body-strong ${delta.className}`}>{delta.text}</p>}
      <TrendChart
        title={`Average health score (last ${trend.days} days)`}
        points={trend.points
          .filter((point) => point.averageHealthScore !== null)
          .map((point) => ({ label: formatShortDate(point.capturedAt), value: point.averageHealthScore as number }))}
        emptyLabel="Not enough scan history yet."
      />
    </div>
  );
}
