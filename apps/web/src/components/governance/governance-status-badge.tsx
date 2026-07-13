// Maps the real GovernanceIssueStatus enum (Open | InProgress | Resolved —
// ADR-0016 §4.5, confirmed as a strict 3-state workflow) to a display style.
const STATUS_STYLES: Record<string, string> = {
  Open: 'bg-slate-100 text-slate-700',
  InProgress: 'bg-blue-100 text-blue-800',
  Resolved: 'bg-green-100 text-green-800',
};

const STATUS_LABELS: Record<string, string> = {
  Open: 'Open',
  InProgress: 'In progress',
  Resolved: 'Resolved',
};

export function GovernanceStatusBadge({ status }: { status: string }): JSX.Element {
  const style = STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700';
  const label = STATUS_LABELS[status] ?? status;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>;
}
