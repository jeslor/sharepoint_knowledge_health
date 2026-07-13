'use client';

import { useEffect, useMemo } from 'react';
import { ScanList } from '@/components/scans/scan-list';
import { ScanScheduleSettings } from '@/components/scans/scan-schedule-settings';
import { ACTIVE_SCAN_STATUSES } from '@/components/scans/scan-status-badge';
import { TriggerScanButton } from '@/components/scans/trigger-scan-button';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { useScans } from '@/lib/api/hooks/use-scans';

const POLL_INTERVAL_MS = 5000;

export default function ScansPage(): JSX.Element {
  const { data: scans, loading, error, refetch } = useScans();

  const hasActiveScan = useMemo(() => scans?.some((scan) => ACTIVE_SCAN_STATUSES.has(scan.status)) ?? false, [scans]);

  useEffect(() => {
    if (!hasActiveScan) return undefined;
    const interval = setInterval(refetch, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasActiveScan, refetch]);

  return (
    <div className="space-y-6">
      <ScanScheduleSettings />

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Scans</h1>
        <TriggerScanButton disabled={hasActiveScan} onTriggered={refetch} />
      </div>
      {loading && <LoadingState label="Loading scans…" />}
      {error && <ErrorState error={error} />}
      {scans && <ScanList scans={scans} />}
    </div>
  );
}
