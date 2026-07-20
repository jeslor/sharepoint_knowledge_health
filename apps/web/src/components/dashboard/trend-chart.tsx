import { Card } from '@/components/ui/card';

const WIDTH = 400;
const HEIGHT = 120;
const PADDING = 8;

export interface TrendChartPoint {
  label: string;
  value: number;
}

interface TrendChartProps {
  title: string;
  points: TrendChartPoint[];
  emptyLabel?: string;
}

// Deliberately dependency-free — a single polyline sparkline is all this
// view needs, and every other chart-shaped need in this codebase so far
// has been served by plain markup rather than pulling in a charting
// library (consistent with the "avoid unnecessary deps" constraint
// carried through every prior phase). Phase 10B: uses the shared Card
// shell (brand-colored line) instead of its own bordered div, so it reads
// consistently with the rest of the redesigned dashboard.
export function TrendChart({ title, points, emptyLabel }: TrendChartProps): JSX.Element {
  if (points.length < 2) {
    return (
      <Card>
        <p className="text-body-strong text-slate-700">{title}</p>
        <p className="mt-2 text-body text-slate-500">{emptyLabel ?? 'Not enough data yet.'}</p>
      </Card>
    );
  }

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const coords = points.map((point, index) => {
    const x = PADDING + (index / (points.length - 1)) * (WIDTH - PADDING * 2);
    const y = HEIGHT - PADDING - ((point.value - min) / range) * (HEIGHT - PADDING * 2);
    return `${x},${y}`;
  });

  return (
    <Card>
      <p className="text-body-strong text-slate-700">{title}</p>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mt-2 h-28 w-full" role="img" aria-label={title}>
        <polyline points={coords.join(' ')} fill="none" stroke="#0f6cb3" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="mt-1 flex justify-between text-caption text-slate-500">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </Card>
  );
}
