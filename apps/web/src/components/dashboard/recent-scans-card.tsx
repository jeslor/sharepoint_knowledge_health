import Link from 'next/link';
import { ScanObjectRegular } from '@fluentui/react-icons';
import type { ScanResponse } from '@sph/types';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScanStatusBadge } from '@/components/scans/scan-status-badge';
import { EmptyState } from '@/components/ui/query-state';

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return '—';
  const seconds = Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

// Phase 10B: "operational confidence" — smaller/lower visual priority than
// the hero and Critical Issues/Governance Alerts, per the approved
// asymmetric hierarchy. Shows only the single most recent scan; the full
// history already has its own page.
export function RecentScansCard({ scans }: { scans: ScanResponse[] }): JSX.Element {
  const [latest] = scans;

  return (
    <Card>
      <CardHeader
        title="Recent scans"
        icon={ScanObjectRegular}
        action={
          <Link href="/dashboard/scans" className="text-body-strong text-brand-600 transition-colors duration-150 ease-premium hover:text-brand-700 hover:underline">
            View all
          </Link>
        }
      />
      {!latest ? (
        <EmptyState label="No scans have been run yet." />
      ) : (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-body text-slate-600">
          <span className="inline-flex items-center gap-2">
            <ScanStatusBadge status={latest.status} />
            {latest.limitReached && <Badge tone="warning">Trial limit reached</Badge>}
          </span>
          <span>
            <span className="text-caption text-slate-500">Duration</span>{' '}
            {formatDuration(latest.startedAt, latest.completedAt)}
          </span>
          <span>
            <span className="text-caption text-slate-500">Documents</span> {latest.documentsScanned}
          </span>
          <span>
            <span className="text-caption text-slate-500">Started</span>{' '}
            {latest.startedAt ? new Date(latest.startedAt).toLocaleString() : '—'}
          </span>
          <Link
            href={`/dashboard/scans/${latest.id}`}
            className="text-body-strong text-brand-600 transition-colors duration-150 ease-premium hover:text-brand-700 hover:underline"
          >
            View details
          </Link>
        </div>
      )}
    </Card>
  );
}
