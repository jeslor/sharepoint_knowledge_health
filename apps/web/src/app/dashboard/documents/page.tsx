'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { DocumentHealthQuery, IssueSeverityFilter, SortDirection } from '@sph/types';
import { DocumentHealthTable } from '@/components/documents/document-health-table';
import { DocumentFilters, type DocumentFilterValues } from '@/components/documents/document-filters';
import { Pagination } from '@/components/ui/pagination';
import { LoadingState, ErrorState } from '@/components/ui/query-state';
import { useDocumentHealth } from '@/lib/api/hooks/use-document-health';
import { useSharePointSites } from '@/lib/api/hooks/use-sharepoint-sites';

function DocumentsPageContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  const query: DocumentHealthQuery = useMemo(
    () => ({
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      sortBy: 'score',
      sortDir: (searchParams.get('sortDir') as SortDirection | null) ?? undefined,
      severity: (searchParams.get('severity') as IssueSeverityFilter | null) ?? undefined,
      siteId: searchParams.get('siteId') ?? undefined,
      minScore: searchParams.get('minScore') ? Number(searchParams.get('minScore')) : undefined,
      maxScore: searchParams.get('maxScore') ? Number(searchParams.get('maxScore')) : undefined,
    }),
    [searchParams],
  );

  const { data, loading, error } = useDocumentHealth(query);
  const { data: sites } = useSharePointSites();

  const updateParams = useCallback(
    (updates: Record<string, string | number | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') params.delete(key);
        else params.set(key, String(value));
      }
      router.push(`/dashboard/documents?${params.toString()}`);
    },
    [router, searchParams],
  );

  const handleFilterChange = useCallback(
    (values: DocumentFilterValues) => {
      updateParams({ ...values, page: 1 });
    },
    [updateParams],
  );

  const handleToggleScoreSort = useCallback(() => {
    updateParams({ sortDir: query.sortDir === 'asc' ? 'desc' : 'asc' });
  }, [updateParams, query.sortDir]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Document health</h1>
      <DocumentFilters
        values={{ severity: query.severity, siteId: query.siteId, minScore: query.minScore, maxScore: query.maxScore }}
        sites={sites ?? []}
        onChange={handleFilterChange}
      />
      {loading && <LoadingState label="Loading documents…" />}
      {error && <ErrorState error={error} />}
      {data && (
        <>
          <DocumentHealthTable documents={data.data} sortDir={query.sortDir ?? 'asc'} onToggleScoreSort={handleToggleScoreSort} />
          <Pagination pagination={data.pagination} onPageChange={(page) => updateParams({ page })} />
        </>
      )}
    </div>
  );
}

export default function DocumentsPage(): JSX.Element {
  return (
    <Suspense fallback={<LoadingState />}>
      <DocumentsPageContent />
    </Suspense>
  );
}
