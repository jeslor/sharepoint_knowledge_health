import type { ReactNode } from 'react';
import type { HealthTrendPoint, HealthTrendResponse } from '@sph/types';

function Card({ label, value, detail }: { label: string; value: string; detail?: ReactNode }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {detail && <p className="mt-1 text-xs">{detail}</p>}
    </div>
  );
}

const NOT_ENOUGH_DATA = <span className="text-slate-500">Not enough data yet</span>;

/**
 * Visual direction indicator (recommendation #3/#4: highlight improving vs
 * declining, not just raw numbers). `higherIsBetter` flips the color for
 * issue counts, where a falling number is the improvement.
 */
function Indicator({ delta, higherIsBetter }: { delta: number; higherIsBetter: boolean }): JSX.Element {
  if (delta === 0) return <span className="text-slate-500">— stable</span>;
  const isImprovement = higherIsBetter ? delta > 0 : delta < 0;
  const arrow = delta > 0 ? '▲' : '▼';
  const signed = delta > 0 ? `+${delta}` : String(delta);
  return <span className={isImprovement ? 'text-emerald-600' : 'text-red-600'}>{arrow} {signed} vs previous scan</span>;
}

function scoredPoints(points: HealthTrendPoint[]): { point: HealthTrendPoint; score: number }[] {
  return points
    .map((point) => (point.averageHealthScore === null ? null : { point, score: point.averageHealthScore }))
    .filter((entry): entry is { point: HealthTrendPoint; score: number } => entry !== null);
}

export function TrendCards({ trend }: { trend: HealthTrendResponse }): JSX.Element {
  const scored = scoredPoints(trend.points);
  const current = trend.points[trend.points.length - 1];
  const previous = trend.points.length >= 2 ? trend.points[trend.points.length - 2] : undefined;

  const currentScore =
    current?.averageHealthScore === undefined || current?.averageHealthScore === null
      ? { value: '—', detail: NOT_ENOUGH_DATA }
      : {
          value: `${current.averageHealthScore}/100`,
          detail:
            previous?.averageHealthScore != null
              ? <Indicator delta={current.averageHealthScore - previous.averageHealthScore} higherIsBetter />
              : NOT_ENOUGH_DATA,
        };

  const previousScore =
    previous?.averageHealthScore == null ? { value: '—', detail: NOT_ENOUGH_DATA } : { value: `${previous.averageHealthScore}/100`, detail: undefined };

  const highest = scored.length > 0 ? { value: `${Math.max(...scored.map((entry) => entry.score))}/100`, detail: undefined } : { value: '—', detail: NOT_ENOUGH_DATA };
  const lowest = scored.length > 0 ? { value: `${Math.min(...scored.map((entry) => entry.score))}/100`, detail: undefined } : { value: '—', detail: NOT_ENOUGH_DATA };
  const average =
    scored.length > 0
      ? { value: `${Math.round(scored.reduce((sum, entry) => sum + entry.score, 0) / scored.length)}/100`, detail: undefined }
      : { value: '—', detail: NOT_ENOUGH_DATA };

  // ADR-0015 §3: HealthSnapshot is written exactly once per completed scan
  // (scanJobId is @unique), so counting the points already returned by
  // the trend query — no separate count query needed.
  const totalCompletedScans = { value: String(trend.points.length), detail: undefined as ReactNode };

  const critical = {
    value: current ? String(current.criticalIssuesCount) : '—',
    detail: current && previous ? <Indicator delta={current.criticalIssuesCount - previous.criticalIssuesCount} higherIsBetter={false} /> : NOT_ENOUGH_DATA,
  };
  const warning = {
    value: current ? String(current.warningIssuesCount) : '—',
    detail: current && previous ? <Indicator delta={current.warningIssuesCount - previous.warningIssuesCount} higherIsBetter={false} /> : NOT_ENOUGH_DATA,
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card label="Current score" value={currentScore.value} detail={currentScore.detail} />
      <Card label="Previous score" value={previousScore.value} detail={previousScore.detail} />
      <Card label="Highest score" value={highest.value} detail={highest.detail} />
      <Card label="Lowest score" value={lowest.value} detail={lowest.detail} />
      <Card label="Average score" value={average.value} detail={average.detail} />
      <Card label="Total completed scans" value={totalCompletedScans.value} detail={totalCompletedScans.detail} />
      <Card label="Critical issues" value={critical.value} detail={critical.detail} />
      <Card label="Warning issues" value={warning.value} detail={warning.detail} />
    </div>
  );
}
