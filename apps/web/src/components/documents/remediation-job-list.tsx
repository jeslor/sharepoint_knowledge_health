import Link from 'next/link';
import type { RemediationJobSummary } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';
import { Spinner } from '@/components/ui/spinner';
import { RemediationJobStatusBadge } from './remediation-job-status-badge';

function formatTimestamp(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

// P0-7: mirrors ScanList's exact shape (status/timestamps/counts table,
// active-row highlight + spinner, a "View" link to the detail route) —
// the closest existing precedent for "a paginated list of background jobs
// with a status that can still be in flight."
export function RemediationJobList({ jobs }: { jobs: RemediationJobSummary[] }): JSX.Element {
  if (jobs.length === 0) {
    return (
      <EmptyState
        label="No remediation jobs yet."
        description="Bulk-remediate documents from the Documents page to see jobs here."
      />
    );
  }

  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200/60 text-slate-500">
          <th className="py-2.5 pr-4 font-medium">Status</th>
          <th className="py-2.5 pr-4 font-medium">Initiated by</th>
          <th className="py-2.5 pr-4 font-medium">Total</th>
          <th className="py-2.5 pr-4 font-medium">Succeeded</th>
          <th className="py-2.5 pr-4 font-medium">Failed</th>
          <th className="py-2.5 pr-4 font-medium">Skipped</th>
          <th className="py-2.5 pr-4 font-medium">Created</th>
          <th className="py-2.5 pr-4 font-medium">Completed</th>
          <th className="py-2.5 pr-4 font-medium" />
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr
            key={job.id}
            className={`transition-colors duration-150 ease-premium hover:bg-slate-50 ${job.status === 'Running' ? 'bg-brand-50/40' : ''}`}
          >
            <td className="py-3 pr-4">
              <span className="inline-flex items-center gap-2">
                <RemediationJobStatusBadge status={job.status} />
                {job.status === 'Running' && <Spinner className="h-3.5 w-3.5 text-brand-600" />}
              </span>
            </td>
            <td className="py-3 pr-4 text-slate-600">{job.initiatedByUserName}</td>
            <td className="py-3 pr-4 text-slate-600">{job.totalCount}</td>
            <td className="py-3 pr-4 text-slate-600">{job.succeededCount}</td>
            <td className="py-3 pr-4 text-slate-600">{job.failedCount}</td>
            <td className="py-3 pr-4 text-slate-600">{job.skippedCount}</td>
            <td className="py-3 pr-4 text-slate-600">{formatTimestamp(job.createdAt)}</td>
            <td className="py-3 pr-4 text-slate-600">{formatTimestamp(job.completedAt)}</td>
            <td className="py-3 pr-4">
              <Link href={`/dashboard/documents/remediation-jobs/${job.id}`} className="text-sm font-medium text-slate-900 underline">
                View
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
