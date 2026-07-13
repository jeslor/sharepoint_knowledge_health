import type { GovernanceSummaryResponse } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';

export function IssuesByType({ byType }: { byType: GovernanceSummaryResponse['byType'] }): JSX.Element {
  const entries = Object.entries(byType).sort(([, a], [, b]) => b - a);

  if (entries.length === 0) {
    return <EmptyState label="No open governance issues." />;
  }

  return (
    <ul className="space-y-1 text-sm">
      {entries.map(([issueType, count]) => (
        <li key={issueType} className="flex items-center justify-between border-b border-slate-100 py-1">
          <span className="text-slate-700">{issueType}</span>
          <span className="font-medium text-slate-900">{count}</span>
        </li>
      ))}
    </ul>
  );
}
