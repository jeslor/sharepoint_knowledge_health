import type { ScanComparisonIssue, ScanComparisonResponse } from '@sph/types';
import { SeverityBadge } from '@/components/documents/severity-badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/query-state';

function formatChange(value: number | null, higherIsBetter: boolean): { text: string; className: string } {
  if (value === null) return { text: '—', className: 'text-slate-500' };
  if (value === 0) return { text: '— stable', className: 'text-slate-500' };
  const isImprovement = higherIsBetter ? value > 0 : value < 0;
  const arrow = value > 0 ? '▲' : '▼';
  const signed = value > 0 ? `+${value}` : String(value);
  return { text: `${arrow} ${signed}`, className: isImprovement ? 'text-green-600' : 'text-red-600' };
}

function ChangeStat({ label, value, higherIsBetter }: { label: string; value: number | null; higherIsBetter: boolean }): JSX.Element {
  const { text, className } = formatChange(value, higherIsBetter);
  return (
    <Card>
      <p className="text-caption text-slate-500">{label}</p>
      <p className={`mt-1 text-section-title ${className}`}>{text}</p>
    </Card>
  );
}

function IssueList({ title, issues, emptyLabel }: { title: string; issues: ScanComparisonIssue[]; emptyLabel: string }): JSX.Element {
  return (
    <div>
      <h3 className="text-body-strong text-slate-700">{title}</h3>
      {issues.length === 0 ? (
        <EmptyState label={emptyLabel} />
      ) : (
        <ul className="mt-2 space-y-2">
          {issues.map((issue, index) => (
            <li key={`${issue.documentId}-${issue.criterion}-${index}`} className="rounded-lg border border-slate-200/60 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{issue.documentName}</span>
                <SeverityBadge severity={issue.severity} />
              </div>
              <p className="mt-1 text-sm text-slate-600">{issue.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ScanComparisonCard({ comparison }: { comparison: ScanComparisonResponse }): JSX.Element {
  if (comparison.previousScanId === null) {
    return <EmptyState label="No previous scan to compare against yet." />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ChangeStat label="Score change" value={comparison.scoreChange} higherIsBetter />
        <ChangeStat label="Critical issues" value={comparison.criticalIssuesChange} higherIsBetter={false} />
        <ChangeStat label="Warning issues" value={comparison.warningIssuesChange} higherIsBetter={false} />
        <ChangeStat label="Documents scanned" value={comparison.documentCountChange} higherIsBetter />
      </div>

      <IssueList title="Newly introduced issues" issues={comparison.newIssues} emptyLabel="No new issues since the previous scan." />
      <IssueList title="Resolved issues" issues={comparison.resolvedIssues} emptyLabel="No issues resolved since the previous scan." />
    </div>
  );
}
