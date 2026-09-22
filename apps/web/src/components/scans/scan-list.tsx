import Link from 'next/link';
import type { ScanResponse } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';
import { JobStatusCard } from '@/components/ui/job-status-card';
import { Spinner } from '@/components/ui/spinner';
import { TableScrollContainer } from '@/components/ui/table-scroll-container';
import { Badge } from '@/components/ui/badge';
import { ScanStatusBadge } from './scan-status-badge';

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function formatProgress(scan: ScanResponse): string {
  if (scan.status === 'Queued') return 'Waiting to start…';
  if (scan.status !== 'Running') return '—';
  if (scan.totalSites === null) return 'Preparing…';
  const site = scan.currentSiteName ? `: ${scan.currentSiteName}` : '';
  return `Site ${scan.sitesCompleted} of ${scan.totalSites}${site}`;
}

// A Queued or Running scan is genuinely still in flight — a small spinner
// next to the progress text (2026-07-25) makes that read as live activity
// between poll ticks, rather than static text that just happens to change
// underneath the reader every few seconds.
function isActive(scan: ScanResponse): boolean {
  return scan.status === 'Queued' || scan.status === 'Running';
}

// Phase 5: a quick, glanceable signal in the list — the full explanation
// (existing documents remain available, Upgrade CTA) lives on the scan
// detail page, not duplicated here per row.
function LimitReachedBadge({ scan }: { scan: ScanResponse }): JSX.Element | null {
  if (!scan.limitReached) return null;
  return <Badge tone="warning">Trial limit reached</Badge>;
}

export function ScanList({ scans }: { scans: ScanResponse[] }): JSX.Element {
  if (scans.length === 0) {
    return <EmptyState label="No scans have been run yet." />;
  }

  return (
    <>
      {/* Below xl: 8 columns (several of them free-text — Progress, Error)
          have no good tabular fit on a phone/tablet screen. Same
          information, one card per scan. */}
      <ul className="space-y-3 xl:hidden">
        {scans.map((scan) => (
          <li key={scan.id}>
            <JobStatusCard
              statusBadge={
                <span className="inline-flex items-center gap-2">
                  <ScanStatusBadge status={scan.status} />
                  <LimitReachedBadge scan={scan} />
                </span>
              }
              active={isActive(scan)}
              viewHref={`/dashboard/scans/${scan.id}`}
              fields={[
                { label: 'Progress', value: formatProgress(scan), fullWidth: true },
                { label: 'Started', value: formatTimestamp(scan.startedAt) },
                { label: 'Completed', value: formatTimestamp(scan.completedAt) },
                { label: 'Documents scanned', value: scan.documentsScanned },
                { label: 'Documents failed', value: scan.documentsFailed },
                ...(scan.errorSummary
                  ? [{ label: 'Error', value: scan.errorSummary, fullWidth: true }]
                  : []),
              ]}
            />
          </li>
        ))}
      </ul>

      {/* Phase 10A.6: whitespace-driven rows (no per-row border) + hover
          feedback (previously missing here, per the original audit). */}
      <div className="hidden xl:block">
        <TableScrollContainer>
          <table className="w-full min-w-[880px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200/60 text-slate-500">
                <th className="py-2.5 pr-4 font-medium">Status</th>
                <th className="py-2.5 pr-4 font-medium">Progress</th>
                <th className="py-2.5 pr-4 font-medium">Started</th>
                <th className="py-2.5 pr-4 font-medium">Completed</th>
                <th className="py-2.5 pr-4 font-medium">Documents scanned</th>
                <th className="py-2.5 pr-4 font-medium">Documents failed</th>
                <th className="py-2.5 pr-4 font-medium">Error</th>
                <th className="py-2.5 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {scans.map((scan) => (
                <tr
                  key={scan.id}
                  className={`transition-colors duration-150 ease-premium hover:bg-slate-50 ${isActive(scan) ? 'bg-brand-50/40' : ''}`}
                >
                  <td className="py-3 pr-4">
                    <span className="inline-flex items-center gap-2">
                      <ScanStatusBadge status={scan.status} />
                      <LimitReachedBadge scan={scan} />
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-slate-600">
                    <span className="inline-flex items-center gap-2">
                      {isActive(scan) && <Spinner className="h-3.5 w-3.5 text-brand-600" />}
                      {formatProgress(scan)}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-slate-600">{formatTimestamp(scan.startedAt)}</td>
                  <td className="py-3 pr-4 text-slate-600">{formatTimestamp(scan.completedAt)}</td>
                  <td className="py-3 pr-4 text-slate-600">{scan.documentsScanned}</td>
                  <td className="py-3 pr-4 text-slate-600">{scan.documentsFailed}</td>
                  <td className="py-3 pr-4 text-slate-600">{scan.errorSummary ?? '—'}</td>
                  <td className="py-3 pr-4">
                    <Link
                      href={`/dashboard/scans/${scan.id}`}
                      className="text-sm font-medium text-slate-900 underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollContainer>
      </div>
    </>
  );
}
