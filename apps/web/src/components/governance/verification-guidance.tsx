// Shared, static text — one definition used for all six issue types,
// rendered once per issue page, not per-type. Generalizes the explanation
// ReviewStatus's remediation control already gave on its own (see
// document-review-date.tsx's footer copy) to the other five types, which
// previously said nothing about verification at all. Pure UX copy — does
// not touch scoring, scanning, reconciliation, stillDetected, or
// GovernanceIssue.status transitions.
export function VerificationGuidance(): JSX.Element {
  return (
    <p className="mt-2 text-xs text-slate-500">
      Knowledge Health will confirm this automatically on the next scan. The issue may stay open until then.
    </p>
  );
}
