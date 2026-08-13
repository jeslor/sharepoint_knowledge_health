import { GOVERNANCE_ISSUE_TYPE_LABELS, type GovernanceIssueTypeValue, type GovernanceSummaryResponse } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';

interface IssuesByTypeProps {
  byType: GovernanceSummaryResponse['byType'];
  // Phase 1 work-queue summary strip: optional, backward-compatible —
  // when provided, each row becomes a button that applies the existing
  // issueType filter (Governance dashboard's own onSelect) with the RAW
  // issueType value (never the display label), and the row shows the
  // shared human-readable label. Omitted entirely by the existing
  // org-wide "Open issues by type" card, whose plain-text rendering is
  // deliberately left exactly as it already was.
  onSelect?: (issueType: string) => void;
}

export function IssuesByType({ byType, onSelect }: IssuesByTypeProps): JSX.Element {
  const entries = Object.entries(byType).sort(([, a], [, b]) => b - a);

  if (entries.length === 0) {
    return <EmptyState label="No open governance issues." />;
  }

  return (
    <ul className="space-y-1 text-sm">
      {entries.map(([issueType, count]) =>
        onSelect ? (
          <li key={issueType}>
            <button
              type="button"
              onClick={() => onSelect(issueType)}
              className="flex w-full items-center justify-between border-b border-slate-100 py-1 text-left transition-colors duration-150 ease-premium hover:text-brand-700"
            >
              <span className="text-slate-700">
                {GOVERNANCE_ISSUE_TYPE_LABELS[issueType as GovernanceIssueTypeValue] ?? issueType}
              </span>
              <span className="font-medium text-slate-900">{count}</span>
            </button>
          </li>
        ) : (
          <li key={issueType} className="flex items-center justify-between border-b border-slate-100 py-1">
            <span className="text-slate-700">{issueType}</span>
            <span className="font-medium text-slate-900">{count}</span>
          </li>
        ),
      )}
    </ul>
  );
}
