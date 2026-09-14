import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { NO_ELIGIBLE_COLUMN_GUIDANCE, NO_ELIGIBLE_COLUMN_STEPS } from '@/components/sharepoint/review-date-status';

interface ReviewDateColumnNoticeProps {
  siteId: string;
  // Whether the document's library has an Active review-date column mapping
  // (DocumentDetailResponse.sharePointManaged). When false, Review Status
  // remediation cannot write review dates — the worker Skips it with "No
  // Active SharePointReviewDateMapping".
  sharePointManaged: boolean;
}

/**
 * Review-date write-back MVP: surfaces the review-date-column prerequisite at
 * the document/ReviewStatus surface, so an admin learns it BEFORE attempting
 * remediation rather than discovering it only from a Skipped job. Reuses the
 * exact guidance/steps the Review Dates configuration page already shows
 * (NO_ELIGIBLE_COLUMN_GUIDANCE / NO_ELIGIBLE_COLUMN_STEPS) — no second set of
 * instructions — and links straight to that page. Automatic column creation
 * is deliberately out of scope (ADR-0016 §17.4); the admin owns the library
 * schema, the app owns the review-date values. Renders nothing for a library
 * that is already configured (managed).
 */
export function ReviewDateColumnNotice({ siteId, sharePointManaged }: ReviewDateColumnNoticeProps): JSX.Element | null {
  if (sharePointManaged) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <Badge tone="warning">Review date column not configured</Badge>
      <p className="mt-2 text-sm text-slate-700">
        This document&apos;s SharePoint library needs a date column before Review Status remediation can update review dates.{' '}
        {NO_ELIGIBLE_COLUMN_GUIDANCE}
      </p>
      {/* Native disclosure — accessible by default, keeps the step-by-step
          out of the way until an admin wants it. Same pattern as the Review
          Dates page's own NoEligibleColumn block. */}
      <details className="mt-2 text-xs text-slate-500">
        <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-900">How do I create this column?</summary>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          {NO_ELIGIBLE_COLUMN_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>
      <Link href={`/dashboard/sharepoint/${siteId}/review-dates`} className={buttonClassName('secondary', 'sm', 'mt-3')}>
        Configure review dates
      </Link>
    </div>
  );
}
