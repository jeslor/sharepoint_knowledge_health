// Maps the real UserStatus enum (Active | Deactivated | PendingApproval —
// ADR-0011/0012) to a display style. No invented status values.
const STATUS_STYLES: Record<string, string> = {
  Active: 'bg-green-100 text-green-800',
  PendingApproval: 'bg-amber-100 text-amber-800',
  Deactivated: 'bg-slate-100 text-slate-500',
};

const STATUS_LABELS: Record<string, string> = {
  Active: 'Active',
  PendingApproval: 'Pending approval',
  Deactivated: 'Deactivated',
};

export function UserStatusBadge({ status }: { status: string }): JSX.Element {
  const style = STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700';
  const label = STATUS_LABELS[status] ?? status;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>;
}
