import { SEVERITY_BANDS } from '../config';
import type { IssueSeverity } from '../types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function diffInDays(now: Date, past: Date): number {
  return Math.max(0, Math.round((now.getTime() - past.getTime()) / MS_PER_DAY));
}

/** 100 at/below fullScoreAt, 0 at/above zeroScoreAt, linear in between. */
export function linearDecayScore(value: number, fullScoreAt: number, zeroScoreAt: number): number {
  if (value <= fullScoreAt) return 100;
  if (value >= zeroScoreAt) return 0;
  const ratio = (value - fullScoreAt) / (zeroScoreAt - fullScoreAt);
  return Math.round(100 * (1 - ratio));
}

export function severityForScore(score: number): IssueSeverity {
  return score >= SEVERITY_BANDS.NEEDS_ATTENTION_MIN ? 'NeedsAttention' : 'RequiresReview';
}
