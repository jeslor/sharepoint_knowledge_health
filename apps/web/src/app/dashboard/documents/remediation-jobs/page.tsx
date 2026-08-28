'use client';

import { Suspense, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { RemediationJobListQuery } from '@sph/types';
import { RemediationJobList } from '@/components/documents/remediation-job-list';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { LoadingState, ErrorState } from '@/components/ui/query-state';
import { useRemediationJobs } from '@/lib/api/hooks/use-remediation-jobs';

// P0-7 (ADR-0022 Phase 7): mirrors audit-log/page.tsx's exact shape — URL
// search params drive page/pageSize (same page/pageSize convention
// RemediationJobListQuery already uses, no second pagination system), a
// Suspense boundary wraps useSearchParams per this app's existing
// convention (documents/governance/audit-log pages all do the same).
function RemediationJobsPageContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  const query: RemediationJobListQuery = useMemo(
    () => ({ page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined }),
    [searchParams],
  );

  const { data, loading, error } = useRemediationJobs(query);

  const updateParams = useCallback(
    (updates: Record<string, string | number | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') params.delete(key);
        else params.set(key, String(value));
      }
      router.push(`/dashboard/documents/remediation-jobs?${params.toString()}`);
    },
    [router, searchParams],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Remediation history"
        description="Bulk remediation jobs created from the Documents page — status, progress, and results."
        action={
          <Link href="/dashboard/documents" className="text-sm font-medium text-brand-700 hover:text-brand-800">
            Back to Documents
          </Link>
        }
      />

      {loading && <LoadingState label="Loading remediation jobs…" />}
      {error && <ErrorState error={error} />}
      {data && (
        <>
          <RemediationJobList jobs={data.data} />
          <Pagination pagination={data.pagination} onPageChange={(page) => updateParams({ page })} />
        </>
      )}
    </div>
  );
}

export default function RemediationJobsPage(): JSX.Element {
  return (
    <Suspense fallback={<LoadingState />}>
      <RemediationJobsPageContent />
    </Suspense>
  );
}
