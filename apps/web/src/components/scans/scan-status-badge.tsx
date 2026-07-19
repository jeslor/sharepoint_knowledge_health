import { Badge } from '@/components/ui/badge';

// Maps the real ScanJobStatus enum (Queued | Running | Completed | Failed |
// Cancelled — ADR-0004) to a display style. No invented status values.
const STATUS_STYLES: Record<string, string> = {
  Queued: 'bg-slate-100 text-slate-700',
  Running: 'bg-blue-100 text-blue-800',
  Completed: 'bg-green-100 text-green-800',
  Failed: 'bg-red-100 text-red-800',
  Cancelled: 'bg-slate-100 text-slate-500',
};

export const ACTIVE_SCAN_STATUSES = new Set(['Queued', 'Running']);

export function ScanStatusBadge({ status }: { status: string }): JSX.Element {
  const style = STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700';
  return <Badge className={style}>{status}</Badge>;
}
