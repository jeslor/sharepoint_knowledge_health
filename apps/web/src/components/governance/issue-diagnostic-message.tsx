interface IssueDiagnosticMessageProps {
  message: string | null;
}

// The diagnostic text an assignee needs to understand what's actually
// wrong, not just the raw issueType enum ("Freshness", "Age", ...).
// Snapshotted once onto GovernanceIssue.message at creation — see that
// column's schema comment for why it's never re-derived. null for issues
// created before this field existed; renders nothing rather than a
// placeholder in that case.
export function IssueDiagnosticMessage({ message }: IssueDiagnosticMessageProps): JSX.Element | null {
  if (!message) return null;

  return (
    <div className="mt-4">
      <h2 className="text-body-strong text-slate-700">Problem</h2>
      <p className="mt-1 text-sm text-slate-700">{message}</p>
    </div>
  );
}
