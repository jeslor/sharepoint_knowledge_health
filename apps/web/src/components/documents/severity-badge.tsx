// Maps the real HealthIssueSeverity enum (NeedsAttention | RequiresReview —
// see ADR-0002's amendment) to a display label. No invented severity
// values (the task brief's HIGH/MEDIUM/LOW example doesn't match this
// backend's actual 2-value enum — that reconciliation was already made in
// Phase 5's scoring engine, not re-litigated here).
const SEVERITY_LABELS: Record<string, string> = {
  RequiresReview: 'Critical',
  NeedsAttention: 'Warning',
};

const SEVERITY_STYLES: Record<string, string> = {
  RequiresReview: 'bg-red-100 text-red-800',
  NeedsAttention: 'bg-amber-100 text-amber-800',
};

export function SeverityBadge({ severity }: { severity: string }): JSX.Element {
  const style = SEVERITY_STYLES[severity] ?? 'bg-slate-100 text-slate-700';
  const label = SEVERITY_LABELS[severity] ?? severity;

  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>;
}
