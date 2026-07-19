import Link from 'next/link';
import { ShieldCheckmarkRegular } from '@fluentui/react-icons';
import type { HealthSummaryResponse } from '@sph/types';
import { Card } from '@/components/ui/card';
import { buttonClassName } from '@/components/ui/button';

// Mirrors packages/scoring/src/config.ts's HEALTH_BANDS — redeclared here
// rather than imported (this frontend stays independent of
// packages/scoring, the same convention packages/types itself follows).
const HEALTHY_MIN = 90;
const NEEDS_ATTENTION_MIN = 70;

function bandMessage(score: number | null): string {
  if (score === null) return 'Run your first scan to see your organization’s health score.';
  if (score >= HEALTHY_MIN) return 'Your SharePoint environment is in good health.';
  if (score >= NEEDS_ATTENTION_MIN) return 'Your SharePoint environment needs attention in a few areas.';
  return 'Your SharePoint environment requires attention.';
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'Less than an hour ago';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <p className="text-caption text-slate-500">{label}</p>
      <p className="mt-0.5 text-section-title text-slate-900">{value}</p>
    </div>
  );
}

// Phase 10B: the dashboard's single most important element — a premium
// hero surface, not "another card." Large, bold, tracked score number +
// a restrained progress bar (not a gauge) + the three supporting facts an
// administrator needs at a glance, per the approved plan.
export function OrganizationHealthHero({ summary }: { summary: HealthSummaryResponse }): JSX.Element {
  const score = summary.averageHealthScore;

  return (
    <Card>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-caption font-medium uppercase tracking-wider text-slate-400">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-50 text-brand-600">
              <ShieldCheckmarkRegular fontSize={14} />
            </span>
            Organization Health
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[3.5rem] font-bold leading-none tracking-tight tabular-nums text-slate-900">{score ?? '—'}</span>
            <span className="text-body text-slate-400">/100</span>
          </div>
          {score !== null && (
            <div className="mt-3 h-1.5 w-40 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-600 transition-[width] duration-500 ease-premium"
                style={{ width: `${score}%` }}
              />
            </div>
          )}
          <p className="mt-3 text-body-strong text-slate-700">{bandMessage(score)}</p>
        </div>

        <div className="flex flex-wrap gap-8">
          <Stat label="Critical issues" value={String(summary.criticalIssuesCount)} />
          <Stat label="Documents analyzed" value={String(summary.totalDocumentsScanned)} />
          <Stat label="Last scan" value={formatRelativeTime(summary.lastSuccessfulScanAt)} />
        </div>
      </div>

      <div className="mt-6">
        <Link href="/dashboard/documents?severity=RequiresReview" className={buttonClassName('primary', 'md')}>
          View critical issues
        </Link>
      </div>
    </Card>
  );
}
