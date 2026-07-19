import Link from 'next/link';
import type { ScanResponse } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';
import { ScanStatusBadge } from './scan-status-badge';

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function formatProgress(scan: ScanResponse): string {
  if (scan.status !== 'Running') return '—';
  if (scan.totalSites === null) return 'Preparing…';
  const site = scan.currentSiteName ? `: ${scan.currentSiteName}` : '';
  return `Site ${scan.sitesCompleted} of ${scan.totalSites}${site}`;
}

export function ScanList({ scans }: { scans: ScanResponse[] }): JSX.Element {
  if (scans.length === 0) {
    return <EmptyState label="No scans have been run yet." />;
  }

  // Phase 10A.6: whitespace-driven rows (no per-row border) + hover
  // feedback (previously missing here, per the original audit).
  return (
    <table className="w-full border-collapse text-left text-sm">
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
          <tr key={scan.id} className="transition-colors duration-150 ease-premium hover:bg-slate-50">
            <td className="py-3 pr-4">
              <ScanStatusBadge status={scan.status} />
            </td>
            <td className="py-3 pr-4 text-slate-600">{formatProgress(scan)}</td>
            <td className="py-3 pr-4 text-slate-600">{formatTimestamp(scan.startedAt)}</td>
            <td className="py-3 pr-4 text-slate-600">{formatTimestamp(scan.completedAt)}</td>
            <td className="py-3 pr-4 text-slate-600">{scan.documentsScanned}</td>
            <td className="py-3 pr-4 text-slate-600">{scan.documentsFailed}</td>
            <td className="py-3 pr-4 text-slate-600">{scan.errorSummary ?? '—'}</td>
            <td className="py-3 pr-4">
              <Link href={`/dashboard/scans/${scan.id}`} className="text-sm font-medium text-slate-900 underline">
                View
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
