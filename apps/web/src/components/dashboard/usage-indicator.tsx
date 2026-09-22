'use client';

import { useState } from 'react';
import { CheckmarkCircleFilled, DataUsageRegular, WarningRegular } from '@fluentui/react-icons';
import type { UsageResponse } from '@sph/types';
import { RequestUpgradeDialog } from './request-upgrade-dialog';

// Phase 5: presentational UX thresholds only — never a second quota
// system. The one authoritative gate (is the trial actually exhausted) is
// always read straight from the backend's own usage.limitReached; these
// two numbers only decide how loud the *presentation* of an
// already-known-safe percentage gets, and are never compared against
// currentDocumentCount/documentLimit directly.
const ELEVATED_THRESHOLD = 75;
const WARNING_THRESHOLD = 90;

function barToneClass(usage: UsageResponse): string {
  if (usage.limitReached) return 'bg-red-600';
  if (usage.usagePercentage === null) return 'bg-slate-400';
  if (usage.usagePercentage >= WARNING_THRESHOLD) return 'bg-amber-600';
  if (usage.usagePercentage >= ELEVATED_THRESHOLD) return 'bg-amber-400';
  return 'bg-brand-600';
}

const SHIMMER = 'animate-shimmer rounded-md bg-gradient-to-r from-slate-200 via-slate-50 to-slate-200 bg-[length:250%_100%]';

function UsageIndicatorSkeleton(): JSX.Element {
  return (
    <div role="status" aria-label="Loading document usage" className="rounded-lg border border-slate-200/60 bg-slate-50 p-3">
      <div className={`h-3 w-24 ${SHIMMER}`} />
      <div className={`mt-2 h-4 w-20 ${SHIMMER}`} />
      <div className={`mt-2 h-1.5 w-full ${SHIMMER}`} />
    </div>
  );
}

interface UsageIndicatorProps {
  usage: UsageResponse | undefined;
  loading: boolean;
  error: Error | undefined;
}

// Persistent, unobtrusive sidebar widget (DashboardNav renders this once,
// below the nav groups) — never a modal, never dismissible-per-navigation.
// Only Trial organizations see it: Standard has no defined usage/limit
// semantics yet (no OrganizationPlanType-specific business rule is invented
// here — see usage-indicator.test.tsx and the Phase 5 report).
export function UsageIndicator({ usage, loading, error }: UsageIndicatorProps): JSX.Element | null {
  const [dialogOpen, setDialogOpen] = useState(false);
  // Phase 6: session-local only, not backend-persisted — there is no GET
  // endpoint yet for "has this organization already requested an upgrade,"
  // so this deliberately does not survive a reload (a stale, forever-true
  // "sent" state would be worse than none). See the Phase 6 report for the
  // tradeoff this accepts.
  const [requestSent, setRequestSent] = useState(false);

  if (loading) return <UsageIndicatorSkeleton />;

  if (!usage) {
    // A small, quiet fallback — never a bold ErrorState box for a
    // secondary sidebar widget, and never a fabricated 0/unlimited value
    // (the task's own explicit instruction: the backend remains
    // authoritative, so "we don't currently know" is the only honest
    // state to render here).
    if (error) {
      return <p className="px-1 text-caption text-slate-400">Document usage unavailable</p>;
    }
    return null;
  }

  if (usage.planType !== 'Trial') return null;

  const remainingLabel = `${usage.remainingDocumentCount.toLocaleString()} document${usage.remainingDocumentCount === 1 ? '' : 's'} remaining`;

  return (
    <div className="rounded-lg border border-slate-200/60 bg-slate-50 p-3">
      <div className="flex items-center gap-1.5 text-caption font-medium uppercase tracking-wider text-slate-400">
        <DataUsageRegular fontSize={14} />
        Document usage
      </div>

      <p className="mt-1.5 text-body-strong tabular-nums text-slate-900">
        {usage.currentDocumentCount.toLocaleString()}
        <span className="text-slate-400"> / {usage.documentLimit.toLocaleString()}</span>
      </p>

      <div
        role="progressbar"
        aria-label="Trial document usage"
        aria-valuenow={usage.usagePercentage ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-premium ${barToneClass(usage)}`}
          style={{ width: `${Math.min(usage.usagePercentage ?? 0, 100)}%` }}
        />
      </div>

      {usage.limitReached ? (
        <div className="mt-2">
          <p className="flex items-center gap-1 text-caption font-medium text-red-700">
            <WarningRegular fontSize={14} />
            Trial limit reached
          </p>
          <p className="mt-0.5 text-caption text-slate-500">
            Your existing documents and knowledge health results remain available.
          </p>
          {requestSent ? (
            <p className="mt-1.5 flex items-center gap-1 text-caption font-medium text-green-700">
              <CheckmarkCircleFilled fontSize={14} />
              Upgrade request sent
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="mt-1.5 text-caption font-medium text-brand-600 underline transition-colors duration-150 ease-premium hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            >
              Request an upgrade
            </button>
          )}
        </div>
      ) : usage.usagePercentage !== null && usage.usagePercentage >= WARNING_THRESHOLD ? (
        <p className="mt-2 flex items-start gap-1 text-caption text-amber-700">
          <WarningRegular fontSize={14} className="mt-0.5 shrink-0" />
          You&rsquo;re approaching your trial document limit. {remainingLabel}.
        </p>
      ) : usage.usagePercentage !== null && usage.usagePercentage >= ELEVATED_THRESHOLD ? (
        <p className="mt-1.5 text-caption text-slate-500">
          {remainingLabel} <span className="text-amber-600">({usage.usagePercentage}% used)</span>
        </p>
      ) : (
        <p className="mt-1.5 text-caption text-slate-500">{remainingLabel}</p>
      )}

      {usage.limitReached && (
        <RequestUpgradeDialog open={dialogOpen} onOpenChange={setDialogOpen} onSuccess={() => setRequestSent(true)} />
      )}
    </div>
  );
}
