import Link from 'next/link';
import type { RemediationItemResult, RemediationItemStatusValue } from '@sph/types';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/query-state';

// Pending here means "still queued/being processed" (ADR-0022 §13.3 — a
// write that succeeds but can't yet be verified also stays Pending,
// retryable, never a distinct status) — info tone reads as "in progress,"
// not a problem, unlike Failed/Skipped.
const STATUS_TONE: Record<RemediationItemStatusValue, BadgeTone> = {
  Pending: 'info',
  Succeeded: 'success',
  Failed: 'critical',
  Skipped: 'warning',
};

// ADR-0022 write-back MVP: RemediationItemResult now carries documentName
// (resolved server-side, tenant-scoped) so each row shows a human-readable
// label instead of an opaque id. Falls back to the id when the document no
// longer resolves (e.g. deleted after the job ran). Each row still links to
// the document detail route for full context.
export function RemediationItemList({ items }: { items: RemediationItemResult[] }): JSX.Element {
  if (items.length === 0) {
    return <EmptyState label="No items in this job." />;
  }

  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200/60 text-slate-500">
          <th className="py-2.5 pr-4 font-medium">Document</th>
          <th className="py-2.5 pr-4 font-medium">Status</th>
          <th className="py-2.5 pr-4 font-medium">Attempts</th>
          <th className="py-2.5 pr-4 font-medium">Error</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.documentId} className="transition-colors duration-150 ease-premium hover:bg-slate-50">
            <td className="py-3 pr-4">
              <Link href={`/dashboard/documents/${item.documentId}`} className="text-slate-900 hover:underline">
                {item.documentName ?? item.documentId}
              </Link>
            </td>
            <td className="py-3 pr-4">
              <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
            </td>
            <td className="py-3 pr-4 text-slate-600">{item.attemptCount}</td>
            <td className="py-3 pr-4 text-slate-600">
              {item.errorType ? (
                <span title={item.errorMessage ?? undefined}>
                  {item.errorType}
                  {item.errorMessage ? `: ${item.errorMessage}` : ''}
                </span>
              ) : (
                '—'
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
