'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { useReviewDateLibraries } from '@/lib/api/hooks/use-review-date-libraries';
import { useClassificationLibraries } from '@/lib/api/hooks/use-classification-libraries';
import { useSharePointSites } from '@/lib/api/hooks/use-sharepoint-sites';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { ReviewDateLibraryList } from '@/components/sharepoint/review-date-library-list';
import { ClassificationFieldManager } from '@/components/sharepoint/classification-field-manager';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { PageHeader } from '@/components/ui/page-header';

interface ReviewDatesPageProps {
  params: Promise<{ siteId: string }>;
}

// Phase 2: confirming a mapping requires the same Admin/GovernanceManager
// role the backend's RolesGuard enforces on confirmReviewDateMapping — this
// only hides the actions for other roles, it isn't the authorization
// boundary itself.
export default function ReviewDatesPage({ params }: ReviewDatesPageProps): JSX.Element {
  const { siteId } = use(params);
  const { user } = useCurrentUser();
  const { libraries, loading, error, refetch } = useReviewDateLibraries(siteId);
  const {
    libraries: classificationLibraries,
    loading: classificationLoading,
    error: classificationError,
    refetch: refetchClassification,
  } = useClassificationLibraries(siteId);
  const { data: sites } = useSharePointSites();

  const siteName = useMemo(() => sites?.find((site) => site.id === siteId)?.displayName, [sites, siteId]);
  const canManage = user?.role === 'Admin' || user?.role === 'GovernanceManager';

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/dashboard/sharepoint" className="text-sm text-slate-500 hover:text-slate-900 hover:underline">
        ← Back to SharePoint sites
      </Link>

      <PageHeader
        title={siteName ? `Review dates: ${siteName}` : 'Review dates'}
        description="Choose which SharePoint column provides review dates for each library, or leave a library unmapped to keep managing its review dates manually in Knowledge Health."
      />

      {loading && <LoadingState label="Loading libraries…" />}
      {error && <ErrorState error={error} />}
      {libraries && <ReviewDateLibraryList siteId={siteId} libraries={libraries} canManage={canManage} onMappingChanged={refetch} />}

      <section className="border-t border-slate-200 pt-6">
        <h2 className="text-base font-semibold text-slate-900">Classification fields</h2>
        <p className="mt-1 text-sm text-slate-500">
          Designate the SharePoint columns that make up this organization&apos;s classification scheme. Taxonomy coverage measures whether
          documents populate these fields — it never validates the values.
        </p>
        <div className="mt-4">
          {classificationLoading && <LoadingState label="Loading libraries…" />}
          {classificationError && <ErrorState error={classificationError} />}
          {classificationLibraries && (
            <ClassificationFieldManager
              siteId={siteId}
              libraries={classificationLibraries}
              canManage={canManage}
              onChanged={refetchClassification}
            />
          )}
        </div>
      </section>
    </div>
  );
}
