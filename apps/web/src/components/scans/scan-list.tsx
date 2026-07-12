import type { ScanResponse } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';
import { ScanStatusBadge } from './scan-status-badge';

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function ScanList({ scans }: { scans: ScanResponse[] }): JSX.Element {
  if (scans.length === 0) {
    return <EmptyState label="No scans have been run yet." />;
  }

  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-slate-500">
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 pr-4 font-medium">Started</th>
          <th className="py-2 pr-4 font-medium">Completed</th>
          <th className="py-2 pr-4 font-medium">Documents scanned</th>
          <th className="py-2 pr-4 font-medium">Documents failed</th>
          <th className="py-2 pr-4 font-medium">Error</th>
        </tr>
      </thead>
      <tbody>
        {scans.map((scan) => (
          <tr key={scan.id} className="border-b border-slate-100">
            <td className="py-2 pr-4">
              <ScanStatusBadge status={scan.status} />
            </td>
            <td className="py-2 pr-4 text-slate-600">{formatTimestamp(scan.startedAt)}</td>
            <td className="py-2 pr-4 text-slate-600">{formatTimestamp(scan.completedAt)}</td>
            <td className="py-2 pr-4 text-slate-600">{scan.documentsScanned}</td>
            <td className="py-2 pr-4 text-slate-600">{scan.documentsFailed}</td>
            <td className="py-2 pr-4 text-slate-600">{scan.errorSummary ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
