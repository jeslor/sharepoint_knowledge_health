import type { GovernanceActivityResponse } from '@sph/types';

// Mirrors GovernanceStatusBadge's own label map — duplicated (3 short
// strings) rather than imported, to avoid a lib -> component dependency
// for something this small.
const STATUS_LABELS: Record<string, string> = { Open: 'Open', InProgress: 'In Progress', Resolved: 'Resolved' };

function statusLabel(value: string | null): string {
  if (value === null) return 'Unknown';
  return STATUS_LABELS[value] ?? value;
}

/**
 * User-friendly, enum-free descriptions (Phase 8C §5) — the raw
 * activityType/previousValue/newValue never reach the UI directly.
 */
export function formatGovernanceActivity(activity: GovernanceActivityResponse): string {
  switch (activity.activityType) {
    case 'IssueCreated':
      return 'created this issue';
    case 'IssueAssigned':
      return `assigned issue to ${activity.newValue ?? 'someone'}`;
    case 'AssigneeChanged':
      return activity.newValue === null
        ? `unassigned ${activity.previousValue ?? 'the previous assignee'}`
        : `reassigned from ${activity.previousValue ?? 'unassigned'} to ${activity.newValue}`;
    case 'StatusChanged':
      return `changed status from ${statusLabel(activity.previousValue)} to ${statusLabel(activity.newValue)}`;
    case 'ResolutionNoteUpdated':
      return 'updated the resolution notes';
    case 'OwnerAssigned':
      return `assigned ${activity.newValue ?? 'an owner'} as document owner`;
    case 'OwnerRemoved':
      return `removed ${activity.previousValue ?? 'an owner'} as document owner`;
    case 'IssueReopened':
      return 'reopened this issue';
    case 'IssueResolved':
      return 'resolved this issue';
    default:
      return activity.activityType;
  }
}

/** "Today" / "Yesterday" / "3 days ago" / a plain date further back. */
export function formatRelativeDay(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (value: Date): number => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 30) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}
