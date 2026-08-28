import type { RemediationJobStatusValue } from '@sph/types';
import { Badge } from '@/components/ui/badge';

// Maps the real RemediationJobStatus enum (Running | Completed — ADR-0022
// §13, P0-2's locked Option A: no Failed value) to a display style. Same
// convention as ScanStatusBadge — no invented status values.
const STATUS_STYLES: Record<RemediationJobStatusValue, string> = {
  Running: 'bg-blue-100 text-blue-800',
  Completed: 'bg-green-100 text-green-800',
};

export function RemediationJobStatusBadge({ status }: { status: RemediationJobStatusValue }): JSX.Element {
  return <Badge className={STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700'}>{status}</Badge>;
}
