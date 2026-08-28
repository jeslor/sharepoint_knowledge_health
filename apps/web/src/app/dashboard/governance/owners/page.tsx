'use client';

import Link from 'next/link';
import { AnalyticsBarChart } from '@/components/governance/analytics-bar-chart';
import { OwnershipCoverageBySiteTable } from '@/components/governance/ownership-coverage-by-site';
import { OwnershipSummaryCards } from '@/components/governance/ownership-summary-cards';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { useOwnershipCoverage } from '@/lib/api/hooks/use-ownership-coverage';

// ADR-0024 Phase A: a small page, not a new subsystem — mirrors
// /dashboard/governance/analytics's exact shape (a sibling analytics-style
// sub-route, no Suspense/useSearchParams needed since this view takes no
// query parameters at all — a current-state snapshot, not a filtered view).
export default function OwnershipCoveragePage(): JSX.Element {
  const { data, loading, error } = useOwnershipCoverage();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ownership coverage"
        description="How much of your active content has an accountable owner, org-wide and by site."
        action={
          <Link href="/dashboard/governance" className="text-sm font-medium text-brand-700 hover:text-brand-800">
            Back to Governance
          </Link>
        }
      />

      {loading && <LoadingState label="Loading ownership coverage…" />}
      {error && <ErrorState error={error} />}
      {data && (
        <>
          <OwnershipSummaryCards bucket={data.organizationWide} />

          <div>
            <h2 className="text-section-title text-slate-900">Coverage by site</h2>
            <div className="mt-3">
              <OwnershipCoverageBySiteTable sites={data.bySite} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AnalyticsBarChart
              title="Owner source"
              buckets={[
                { label: 'From SharePoint', count: data.ownerSourceBreakdown.graphMetadataCount },
                { label: 'Manually assigned', count: data.ownerSourceBreakdown.manualAssignmentCount },
              ]}
            />
            <AnalyticsBarChart
              title="Owner identity"
              buckets={[
                { label: 'Active platform user', count: data.identityBreakdown.activeRegisteredCount },
                { label: 'Deactivated platform user', count: data.identityBreakdown.deactivatedRegisteredCount },
                { label: 'External / unregistered', count: data.identityBreakdown.externalOrUnregisteredCount },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
