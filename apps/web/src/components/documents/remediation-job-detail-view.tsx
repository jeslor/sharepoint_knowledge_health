'use client';

import { GOVERNANCE_ISSUE_TYPE_LABELS } from '@sph/types';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { Spinner } from '@/components/ui/spinner';
import { useRemediationJob } from '@/lib/api/hooks/use-remediation-job';
import { RemediationItemList } from './remediation-item-list';
import { RemediationJobStatusBadge } from './remediation-job-status-badge';

function formatTimestamp(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

// P0-7 (ADR-0022 Phase 7): the same view serves both "active job progress"
// and "completed job detail" — they're the same underlying data and
// endpoint (GET .../remediation-jobs/:jobId), differing only in whether
// useRemediationJob is currently polling (job.status === 'Running'), so a
// single view avoids building two UIs for one response shape. Kept as a
// plain-prop component (frontend-rules.md: "Pages handle composition.
// Components handle presentation.") rather than folded into the page
// itself, since the page's own `use(params)` unwrapping isn't something a
// component test can drive directly.
export function RemediationJobDetailView({ jobId }: { jobId: string }): JSX.Element {
  const { data: job, loading, error } = useRemediationJob(jobId);

  if (loading) return <LoadingState label="Loading remediation job…" />;
  if (error) return <ErrorState error={error} />;
  if (!job) return <ErrorState error={new Error('Remediation job not found.')} />;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-page-title text-slate-900">Remediation job</h1>
          <RemediationJobStatusBadge status={job.status} />
          {job.status === 'Running' && <Spinner className="h-4 w-4 text-brand-600" />}
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-slate-600">
          <dt className="font-medium text-slate-500">Issue type</dt>
          <dd>{GOVERNANCE_ISSUE_TYPE_LABELS[job.issueType] ?? job.issueType}</dd>
          <dt className="font-medium text-slate-500">Requested review date</dt>
          <dd>{job.nextReviewDueAt ? new Date(job.nextReviewDueAt).toLocaleDateString() : '—'}</dd>
          <dt className="font-medium text-slate-500">Initiated by</dt>
          <dd>{job.initiatedByUserName}</dd>
          <dt className="font-medium text-slate-500">Total documents</dt>
          <dd>{job.totalCount}</dd>
          <dt className="font-medium text-slate-500">Succeeded</dt>
          <dd>{job.succeededCount}</dd>
          <dt className="font-medium text-slate-500">Failed</dt>
          <dd>{job.failedCount}</dd>
          <dt className="font-medium text-slate-500">Skipped</dt>
          <dd>{job.skippedCount}</dd>
          <dt className="font-medium text-slate-500">Created</dt>
          <dd>{formatTimestamp(job.createdAt)}</dd>
          <dt className="font-medium text-slate-500">Completed</dt>
          <dd>{formatTimestamp(job.completedAt)}</dd>
        </dl>
      </div>

      <div>
        <h2 className="text-section-title text-slate-900">Item results</h2>
        <div className="mt-2">
          <RemediationItemList items={job.items} />
        </div>
      </div>
    </div>
  );
}
