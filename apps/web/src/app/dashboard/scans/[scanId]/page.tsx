'use client';

import { use } from 'react';
import { ScanComparisonCard } from '@/components/scans/scan-comparison-card';
import { ScanStatusBadge } from '@/components/scans/scan-status-badge';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { useScan } from '@/lib/api/hooks/use-scan';
import { useScanComparison } from '@/lib/api/hooks/use-scan-comparison';

interface ScanDetailPageProps {
  params: Promise<{ scanId: string }>;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export default function ScanDetailPage({ params }: ScanDetailPageProps): JSX.Element {
  const { scanId } = use(params);
  const { data: scan, loading, error } = useScan(scanId);
  const { data: comparison, loading: comparisonLoading, error: comparisonError } = useScanComparison(scanId);

  if (loading) return <LoadingState label="Loading scan…" />;
  if (error) return <ErrorState error={error} />;
  if (!scan) return <ErrorState error={new Error('Scan not found.')} />;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-page-title text-slate-900">Scan {scan.id}</h1>
          <ScanStatusBadge status={scan.status} />
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-slate-600">
          <dt className="font-medium text-slate-500">Trigger</dt>
          <dd>{scan.triggerSource}</dd>
          <dt className="font-medium text-slate-500">Started</dt>
          <dd>{formatTimestamp(scan.startedAt)}</dd>
          <dt className="font-medium text-slate-500">Completed</dt>
          <dd>{formatTimestamp(scan.completedAt)}</dd>
          <dt className="font-medium text-slate-500">Documents scanned</dt>
          <dd>{scan.documentsScanned}</dd>
          <dt className="font-medium text-slate-500">Documents failed</dt>
          <dd>{scan.documentsFailed}</dd>
          {scan.errorSummary && (
            <>
              <dt className="font-medium text-slate-500">Error</dt>
              <dd>{scan.errorSummary}</dd>
            </>
          )}
        </dl>
      </div>

      <div>
        <h2 className="text-section-title text-slate-900">Comparison to previous scan</h2>
        <div className="mt-2">
          {comparisonLoading && <LoadingState label="Loading comparison…" />}
          {comparisonError && <ErrorState error={comparisonError} />}
          {comparison && <ScanComparisonCard comparison={comparison} />}
        </div>
      </div>
    </div>
  );
}
