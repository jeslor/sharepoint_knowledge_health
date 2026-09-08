import Link from 'next/link';
import { ErrorCircleFilled, ShieldRegular } from '@fluentui/react-icons';
import type { GovernanceIssueTypeValue, GovernanceSummaryResponse } from '@sph/types';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/query-state';

// Human-readable framing for each GovernanceIssueTypeValue — no pre-existing
// label map for this (issues-by-type.tsx shows raw enum values), so this is
// new, but describes exactly the same real, already-computed byType counts,
// not invented data.
const ISSUE_COPY: Record<GovernanceIssueTypeValue, { title: string; description: (count: number) => string }> = {
  Freshness: { title: 'Documents not recently updated', description: (n) => `${n} document${n === 1 ? '' : 's'} may be out of date` },
  Ownership: { title: 'Documents without an owner', description: (n) => `${n} document${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} an assigned owner` },
  ReviewStatus: { title: 'Documents without a scheduled review', description: (n) => `${n} document${n === 1 ? '' : 's'} require review scheduling` },
  Metadata: { title: 'Documents with incomplete metadata', description: (n) => `${n} document${n === 1 ? '' : 's'} are missing key metadata` },
  Duplication: { title: 'Duplicate documents', description: (n) => `${n} document${n === 1 ? '' : 's'} appear to be duplicates` },
  Age: { title: 'Aging documents', description: (n) => `${n} document${n === 1 ? '' : 's'} have not been reviewed in a long time` },
  Taxonomy: { title: 'Documents missing classification', description: (n) => `${n} document${n === 1 ? '' : 's'} are missing designated classification fields` },
};

// Top few issue types by open count — the highest-leverage things an
// administrator can act on right now, not an exhaustive breakdown.
const MAX_ISSUES_SHOWN = 4;

interface CriticalIssuesCardProps {
  summary: GovernanceSummaryResponse;
}

// Phase 10B: "what should the administrator fix?" — the second most
// important element on the page, sized/positioned to match (wider column
// in the asymmetric grid, per the approved plan).
export function CriticalIssuesCard({ summary }: CriticalIssuesCardProps): JSX.Element {
  const entries = (Object.entries(summary.byType) as [GovernanceIssueTypeValue, number][])
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, MAX_ISSUES_SHOWN);

  return (
    <Card>
      <CardHeader title="Critical issues" icon={ShieldRegular} action={<span className="text-caption text-slate-500">{summary.criticalCount} total</span>} />
      {entries.length === 0 ? (
        <EmptyState label="No critical issues found." description="Your SharePoint environment is healthy." />
      ) : (
        <ul className="space-y-4">
          {entries.map(([issueType, count]) => {
            const copy = ISSUE_COPY[issueType];
            return (
              <li key={issueType} className="flex items-start justify-between gap-4 border-t border-slate-200/60 pt-4 first:border-t-0 first:pt-0">
                <div className="flex items-start gap-3">
                  <ErrorCircleFilled fontSize={18} className="mt-0.5 shrink-0 text-red-600" />
                  <div>
                    <p className="text-body-strong text-slate-900">{copy?.title ?? issueType}</p>
                    <p className="text-body text-slate-500">{copy?.description(count) ?? `${count} affected`}</p>
                  </div>
                </div>
                <Link
                  href={`/dashboard/governance?issueType=${issueType}`}
                  className="shrink-0 whitespace-nowrap text-body-strong text-brand-600 transition-colors duration-150 ease-premium hover:text-brand-700 hover:underline"
                >
                  Review documents
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
