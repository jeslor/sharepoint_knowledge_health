import Link from 'next/link';
import { CheckmarkCircleRegular, DismissCircleRegular, EditRegular, PlayCircleRegular, type FluentIcon } from '@fluentui/react-icons';
import type { AuditLogResponse } from '@sph/types';
import type { BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/query-state';
import { formatRelativeDay } from '@/lib/format-governance-activity';

interface ActionStyle {
  icon: FluentIcon;
  tone: BadgeTone;
  label: string;
}

// ADR-0019: action is a plain string column, a closed set in practice but
// not in the type system — every value AuditLogService's 8 call sites
// actually write today, mapped for readability. Anything not in this map
// (a future action added before this map is updated) falls back to the
// raw string via actionStyle() below, never crashes or renders blank —
// matching GovernanceStatusBadge's identical map+fallback discipline.
const ACTION_STYLES: Partial<Record<string, ActionStyle>> = {
  'user.approved': { icon: CheckmarkCircleRegular, tone: 'success', label: 'User approved' },
  'user.rejected': { icon: DismissCircleRegular, tone: 'critical', label: 'User rejected' },
  'sharepoint_site.approved': { icon: CheckmarkCircleRegular, tone: 'success', label: 'Site approved' },
  'sharepoint_site.revoked': { icon: DismissCircleRegular, tone: 'critical', label: 'Site access revoked' },
  'scan.triggered': { icon: PlayCircleRegular, tone: 'info', label: 'Scan triggered' },
  'scan_schedule.created': { icon: CheckmarkCircleRegular, tone: 'success', label: 'Scan schedule created' },
  'scan_schedule.updated': { icon: EditRegular, tone: 'neutral', label: 'Scan schedule updated' },
  'microsoft_tenant.connected': { icon: CheckmarkCircleRegular, tone: 'success', label: 'Microsoft 365 connected' },
};

const TONE_TEXT_CLASS: Record<BadgeTone, string> = {
  neutral: 'text-slate-500',
  info: 'text-blue-600',
  success: 'text-green-600',
  warning: 'text-amber-600',
  critical: 'text-red-600',
};

function actionStyle(action: string): ActionStyle {
  return ACTION_STYLES[action] ?? { icon: EditRegular, tone: 'neutral', label: action };
}

const TARGET_TYPE_LABELS: Partial<Record<string, string>> = {
  User: 'User',
  SharePointSite: 'SharePoint site',
  ScanJob: 'Scan',
  ScanSchedule: 'Scan schedule',
  MicrosoftTenant: 'Microsoft tenant',
};

// Only ScanJob has a real per-entity page today
// (/dashboard/scans/[scanId]) — every other targetType renders as plain
// text. Deliberately not a generic "link if a route might exist" helper —
// a dead or misleading link is worse than no link (matches AppHeader's own
// "never a decorative/hollow affordance" precedent).
function targetHref(entry: AuditLogResponse): string | null {
  if (entry.targetType === 'ScanJob') return `/dashboard/scans/${entry.targetId}`;
  return null;
}

interface DayGroup {
  label: string;
  entries: AuditLogResponse[];
}

function groupByDay(entries: AuditLogResponse[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const label = formatRelativeDay(entry.createdAt);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.label === label) {
      lastGroup.entries.push(entry);
    } else {
      groups.push({ label, entries: [entry] });
    }
  }
  return groups;
}

interface AuditLogListProps {
  entries: AuditLogResponse[];
}

export function AuditLogList({ entries }: AuditLogListProps): JSX.Element {
  if (entries.length === 0) {
    return <EmptyState label="No audit history yet" description="Administrative actions in this organization will appear here." />;
  }

  return (
    <div className="space-y-4">
      {groupByDay(entries).map((group) => (
        <div key={`${group.label}-${group.entries[0]?.id}`}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</h3>
          <ul className="mt-1 divide-y divide-slate-200/60">
            {group.entries.map((entry) => {
              const style = actionStyle(entry.action);
              const Icon = style.icon;
              const href = targetHref(entry);
              // Backend already resolves both the reserved system-driven
              // case (null) and an unresolvable actor (the literal string
              // "Unknown user") to a displayable value — no extra lookup
              // or branching needed here.
              const actorName = entry.actorUserName ?? 'System';
              const targetLabel = TARGET_TYPE_LABELS[entry.targetType] ?? entry.targetType;

              return (
                <li key={entry.id} className="flex items-start justify-between gap-4 px-1 py-3">
                  <span className="flex items-start gap-2">
                    <Icon fontSize={18} className={`mt-0.5 shrink-0 ${TONE_TEXT_CLASS[style.tone]}`} />
                    <span className="text-sm text-slate-700">
                      <span className="font-medium text-slate-900">{style.label}</span> by{' '}
                      <span className="font-medium text-slate-900">{actorName}</span> ·{' '}
                      {href ? (
                        <Link href={href} className="text-brand-600 underline hover:text-brand-700">
                          {targetLabel}
                        </Link>
                      ) : (
                        <span>{targetLabel}</span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">{new Date(entry.createdAt).toLocaleTimeString()}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
