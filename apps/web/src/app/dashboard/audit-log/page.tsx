'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AuditLogListQuery } from '@sph/types';
import { AuditLogFilters, type AuditLogFilterValues } from '@/components/audit-log/audit-log-filters';
import { AuditLogList } from '@/components/audit-log/audit-log-list';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { LoadingState, ErrorState } from '@/components/ui/query-state';
import { useAuditLog } from '@/lib/api/hooks/use-audit-log';

function AuditLogPageContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  const query: AuditLogListQuery = useMemo(
    () => ({
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      action: searchParams.get('action') ?? undefined,
      targetType: searchParams.get('targetType') ?? undefined,
      since: searchParams.get('since') ?? undefined,
      until: searchParams.get('until') ?? undefined,
    }),
    [searchParams],
  );

  const { data, loading, error } = useAuditLog(query);

  const updateParams = useCallback(
    (updates: Record<string, string | number | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') params.delete(key);
        else params.set(key, String(value));
      }
      router.push(`/dashboard/audit-log?${params.toString()}`);
    },
    [router, searchParams],
  );

  const handleFilterChange = useCallback(
    (values: AuditLogFilterValues) => {
      updateParams({ ...values, page: 1 });
    },
    [updateParams],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Every administrative action taken in this organization — site approvals, user access changes, scan configuration, and Microsoft 365 connections."
      />

      <AuditLogFilters
        values={{ action: query.action, targetType: query.targetType, since: query.since, until: query.until }}
        onChange={handleFilterChange}
      />

      {loading && <LoadingState label="Loading audit log…" />}
      {error && <ErrorState error={error} />}
      {data && (
        <>
          <AuditLogList entries={data.data} />
          <Pagination pagination={data.pagination} onPageChange={(page) => updateParams({ page })} />
        </>
      )}
    </div>
  );
}

export default function AuditLogPage(): JSX.Element {
  return (
    <Suspense fallback={<LoadingState />}>
      <AuditLogPageContent />
    </Suspense>
  );
}
