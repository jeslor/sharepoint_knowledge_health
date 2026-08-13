import Link from 'next/link';
import type { NotificationResponse } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';
import { formatRelativeDay } from '@/lib/format-governance-activity';

interface NotificationListProps {
  notifications: NotificationResponse[];
  onOpen: (notificationId: string) => void;
}

// governanceIssueId is set for every trigger except OwnerAssigned (which
// only carries documentId) — see NotificationReconciliationService /
// GovernanceActivityService's notify call sites. Falls back to no link at
// all if a future notification type somehow carries neither, rather than
// assuming one is always present.
function targetHref(notification: NotificationResponse): string | null {
  if (notification.governanceIssueId) return `/dashboard/governance/issues/${notification.governanceIssueId}`;
  if (notification.documentId) return `/dashboard/documents/${notification.documentId}`;
  return null;
}

// Deliberately minimal — no per-type icon set, matching ActivityList's own
// plain text-plus-timestamp style rather than inventing new visual
// vocabulary for a first version of this view.
export function NotificationList({ notifications, onOpen }: NotificationListProps): JSX.Element {
  if (notifications.length === 0) {
    return <EmptyState label="You're all caught up" description="No notifications to show." />;
  }

  return (
    <ul className="divide-y divide-slate-200/60">
      {notifications.map((notification) => {
        const href = targetHref(notification);
        const content = (
          <>
            <span className="flex items-start gap-2">
              {/* Unread indicator — a small dot, not a full badge, so it
                  doesn't compete visually with the message text. Always
                  rendered (never conditionally omitted) so its gap-2 slot
                  is reserved either way — otherwise a read row's message
                  text starts flush left while an unread row's text is
                  pushed right by the dot, leaving read/unread rows
                  misaligned with each other in the same list. `invisible`
                  keeps the exact same layout size while hiding it visually
                  and from screen readers (aria-hidden stays). */}
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600 ${notification.read ? 'invisible' : ''}`}
                aria-hidden="true"
              />
              <span className={notification.read ? 'text-slate-600' : 'text-body-strong text-slate-900'}>{notification.message}</span>
            </span>
            <span className="shrink-0 text-caption text-slate-400">{formatRelativeDay(notification.createdAt)}</span>
          </>
        );

        return (
          <li key={notification.id}>
            {href ? (
              <Link
                href={href}
                onClick={() => onOpen(notification.id)}
                className="flex items-start justify-between gap-4 px-1 py-3 transition-colors duration-150 ease-premium hover:bg-slate-50"
              >
                {content}
              </Link>
            ) : (
              <div className="flex items-start justify-between gap-4 px-1 py-3">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
