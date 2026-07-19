'use client';

import { useEffect, useMemo } from 'react';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { ScanList } from '@/components/scans/scan-list';
import { ScanScheduleSettings } from '@/components/scans/scan-schedule-settings';
import { ACTIVE_SCAN_STATUSES } from '@/components/scans/scan-status-badge';
import { TriggerScanButton } from '@/components/scans/trigger-scan-button';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { useScans } from '@/lib/api/hooks/use-scans';

const POLL_INTERVAL_MS = 5000;

export default function ScansPage(): JSX.Element {
  const { user } = useCurrentUser();
  const { data: scans, loading, error, refetch } = useScans();

  const hasActiveScan = useMemo(() => scans?.some((scan) => ACTIVE_SCAN_STATUSES.has(scan.status)) ?? false, [scans]);

  useEffect(() => {
    if (!hasActiveScan) return undefined;
    const interval = setInterval(refetch, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [hasActiveScan, refetch]);

  // Phase 9.5: triggering and scheduling scans are Admin-only server-side
  // (ScansController/ScanScheduleController) — hidden here for other roles
  // rather than left visible only to fail with a 403 on click.
  const isAdmin = user?.role === 'Admin';

  return (
    <div className="space-y-6">
      <ScanScheduleSettings canManage={isAdmin} />

      <PageHeader
        title="Scans"
        action={isAdmin && <TriggerScanButton disabled={hasActiveScan} onTriggered={refetch} />}
      />
      {loading && <LoadingState label="Loading scans…" />}
      {error && <ErrorState error={error} />}
      {scans && <ScanList scans={scans} />}
    </div>
  );
}
