import Link from 'next/link';
import { GOVERNANCE_ISSUE_TYPE_LABELS, type GovernanceIssueResponse } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';
import { SeverityBadge } from '@/components/documents/severity-badge';
import { GovernanceStatusBadge } from './governance-status-badge';

export function GovernanceIssueList({ issues }: { issues: GovernanceIssueResponse[] }): JSX.Element {
  if (issues.length === 0) {
    return <EmptyState label="No governance issues match the current filters." />;
  }

  // Phase 10A.6: whitespace-driven rows (no per-row border), softened
  // header separator.
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200/60 text-slate-500">
          <th className="py-2.5 pr-4 font-medium">Document</th>
          <th className="py-2.5 pr-4 font-medium">Type</th>
          <th className="py-2.5 pr-4 font-medium">Severity</th>
          <th className="py-2.5 pr-4 font-medium">Status</th>
          <th className="py-2.5 pr-4 font-medium">Assigned to</th>
          <th className="py-2.5 pr-4 font-medium">Still detected</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue) => (
          <tr key={issue.id} className="transition-colors duration-150 ease-premium hover:bg-slate-50">
            <td className="py-3 pr-4">
              <Link href={`/dashboard/governance/issues/${issue.id}`} className="text-slate-900 hover:underline">
                {issue.documentName}
              </Link>
              <p className="text-xs text-slate-500">{issue.siteName}</p>
            </td>
            <td className="py-3 pr-4 text-slate-600">{GOVERNANCE_ISSUE_TYPE_LABELS[issue.issueType] ?? issue.issueType}</td>
            <td className="py-3 pr-4">
              <SeverityBadge severity={issue.severity} />
            </td>
            <td className="py-3 pr-4">
              <GovernanceStatusBadge status={issue.status} />
            </td>
            <td className="py-3 pr-4 text-slate-600">{issue.assignedUserName ?? 'Unassigned'}</td>
            <td className="py-3 pr-4 text-slate-600">{issue.stillDetected ? 'Yes' : 'No'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
