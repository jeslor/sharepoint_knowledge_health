import Link from 'next/link';
import type { GovernanceActivityResponse } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';
import { formatGovernanceActivity, formatRelativeDay } from '@/lib/format-governance-activity';

interface ActivityGroup {
  label: string;
  items: GovernanceActivityResponse[];
}

function groupByDay(activities: GovernanceActivityResponse[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const activity of activities) {
    const label = formatRelativeDay(activity.createdAt);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.label === label) {
      lastGroup.items.push(activity);
    } else {
      groups.push({ label, items: [activity] });
    }
  }
  return groups;
}

interface ActivityListProps {
  activities: GovernanceActivityResponse[];
  /** Shows a link to the related issue — used on the org-wide feed, not the issue-scoped tab (redundant there). */
  showIssueLink?: boolean;
}

export function ActivityList({ activities, showIssueLink = false }: ActivityListProps): JSX.Element {
  if (activities.length === 0) {
    return <EmptyState label="No activity yet." />;
  }

  return (
    <div className="space-y-4">
      {groupByDay(activities).map((group) => (
        <div key={`${group.label}-${group.items[0]?.id}`}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</h3>
          <ul className="mt-1 space-y-1">
            {group.items.map((activity) => (
              <li key={activity.id} className="flex items-center justify-between text-sm text-slate-700">
                <span>
                  <span className="font-medium text-slate-900">{activity.actorUserName}</span>{' '}
                  {formatGovernanceActivity(activity)}
                  {showIssueLink && activity.governanceIssueId && (
                    <>
                      {' '}
                      (
                      <Link href={`/dashboard/governance/issues/${activity.governanceIssueId}`} className="underline">
                        {activity.documentName}
                      </Link>
                      )
                    </>
                  )}
                </span>
                <span className="text-xs text-slate-400">{new Date(activity.createdAt).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
