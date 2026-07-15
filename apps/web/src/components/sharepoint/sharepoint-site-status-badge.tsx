// Maps the real SharePointSiteStatus enum (Discovered | Approved | Removed
// — ADR-0014) to a display style. No invented status values.
const STATUS_STYLES: Record<string, string> = {
  Discovered: 'bg-amber-100 text-amber-800',
  Approved: 'bg-green-100 text-green-800',
  Removed: 'bg-slate-100 text-slate-500',
};

const STATUS_LABELS: Record<string, string> = {
  Discovered: 'Pending approval',
  Approved: 'Approved',
  Removed: 'Revoked',
};

export function SharePointSiteStatusBadge({ status }: { status: string }): JSX.Element {
  const style = STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700';
  const label = STATUS_LABELS[status] ?? status;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>;
}
