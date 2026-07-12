// Maps the real HealthBand enum (Healthy | NeedsAttention | RequiresReview
// — ADR-0002) to a display color. Same bands the scoring engine itself
// computes, not a separate frontend threshold.
const BAND_STYLES: Record<string, string> = {
  Healthy: 'bg-green-100 text-green-800',
  NeedsAttention: 'bg-amber-100 text-amber-800',
  RequiresReview: 'bg-red-100 text-red-800',
};

export function HealthScoreBadge({ score, band }: { score: number; band: string }): JSX.Element {
  const style = BAND_STYLES[band] ?? 'bg-slate-100 text-slate-700';

  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}>{score}/100</span>;
}
