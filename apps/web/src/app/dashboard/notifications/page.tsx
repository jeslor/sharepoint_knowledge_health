'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { NotificationListQuery } from '@sph/types';
import { NotificationList } from '@/components/notifications/notification-list';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { LoadingState, ErrorState } from '@/components/ui/query-state';
import { useNotificationActions } from '@/lib/api/hooks/use-notification-actions';
import { useNotifications } from '@/lib/api/hooks/use-notifications';

function NotificationsPageContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  const query: NotificationListQuery = useMemo(
    () => ({
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      read: searchParams.get('read') === 'false' ? false : undefined,
    }),
    [searchParams],
  );

  const { data, loading, error, refetch } = useNotifications(query);
  const { markRead, markAllRead, working: markingAllRead } = useNotificationActions(refetch);

  const updateParams = useCallback(
    (updates: Record<string, string | number | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') params.delete(key);
        else params.set(key, String(value));
      }
      router.push(`/dashboard/notifications?${params.toString()}`);
    },
    [router, searchParams],
  );

  const unreadOnly = query.read === false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Governance issues assigned to you, ownership changes, and resolution suggestions from the latest scan."
        action={
          <Button variant="secondary" size="sm" disabled={markingAllRead} onClick={() => void markAllRead()}>
            {markingAllRead ? 'Marking…' : 'Mark all read'}
          </Button>
        }
      />

      <div className="flex items-center gap-2 text-sm">
        <Button
          variant={unreadOnly ? 'secondary' : 'primary'}
          size="sm"
          onClick={() => updateParams({ read: undefined, page: 1 })}
        >
          All
        </Button>
        <Button
          variant={unreadOnly ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => updateParams({ read: 'false', page: 1 })}
        >
          Unread only
        </Button>
      </div>

      {loading && <LoadingState label="Loading notifications…" />}
      {error && <ErrorState error={error} />}
      {data && (
        <>
          <NotificationList notifications={data.data} onOpen={markRead} />
          <Pagination pagination={data.pagination} onPageChange={(page) => updateParams({ page })} />
        </>
      )}
    </div>
  );
}

export default function NotificationsPage(): JSX.Element {
  return (
    <Suspense fallback={<LoadingState />}>
      <NotificationsPageContent />
    </Suspense>
  );
}
