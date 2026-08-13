import type { ReviewDateEligibilityResponse, ReviewDateMappingResponse } from '@sph/types';
import type { BadgeTone } from '@/components/ui/badge';

// "Not checked yet" and "checked, no eligible column" are different facts
// and must never collapse into the same UI state (ADR-0016 §17.4) — this
// is why NotChecked is its own variant here rather than being folded into
// NoEligibleColumn. Neither exists as a server-persisted status; both are
// derived client-side from whether an eligibility check has been run this
// session, combined with whatever mapping state the server does persist.
export type ReviewDateLibraryStatus =
  | { kind: 'NotChecked' }
  | { kind: 'NoEligibleColumn' }
  | { kind: 'SingleEligibleColumn'; eligibility: Extract<ReviewDateEligibilityResponse, { status: 'SingleEligibleColumn' }> }
  | { kind: 'MultipleEligibleColumns'; eligibility: Extract<ReviewDateEligibilityResponse, { status: 'MultipleEligibleColumns' }> }
  | { kind: 'Active'; mapping: ReviewDateMappingResponse }
  | { kind: 'Stale'; mapping: ReviewDateMappingResponse };

/**
 * A confirmed mapping (Active/Stale, from the server) always takes
 * precedence over a client-side eligibility check result — a library
 * can't simultaneously be "confirmed" and "awaiting a check." Absent a
 * mapping, the eligibility check result (if one has been run this
 * session) determines the state; absent both, NotChecked.
 */
export function deriveReviewDateLibraryStatus(
  mapping: ReviewDateMappingResponse | null,
  eligibility: ReviewDateEligibilityResponse | undefined,
): ReviewDateLibraryStatus {
  if (mapping) {
    return mapping.status === 'Stale' ? { kind: 'Stale', mapping } : { kind: 'Active', mapping };
  }
  if (!eligibility) return { kind: 'NotChecked' };
  if (eligibility.status === 'NoEligibleColumn') return { kind: 'NoEligibleColumn' };
  if (eligibility.status === 'SingleEligibleColumn') return { kind: 'SingleEligibleColumn', eligibility };
  return { kind: 'MultipleEligibleColumns', eligibility };
}

export const REVIEW_DATE_STATUS_LABEL: Record<ReviewDateLibraryStatus['kind'], string> = {
  NotChecked: 'Not checked',
  NoEligibleColumn: 'No SharePoint column found',
  SingleEligibleColumn: 'Action needed',
  MultipleEligibleColumns: 'Action needed',
  Active: 'SharePoint review dates enabled',
  Stale: 'SharePoint column unavailable',
};

export const REVIEW_DATE_STATUS_TONE: Record<ReviewDateLibraryStatus['kind'], BadgeTone> = {
  NotChecked: 'neutral',
  NoEligibleColumn: 'neutral',
  SingleEligibleColumn: 'warning',
  MultipleEligibleColumns: 'warning',
  Active: 'success',
  Stale: 'critical',
};

export function reviewDateStatusExplanation(status: ReviewDateLibraryStatus): string {
  switch (status.kind) {
    case 'NotChecked':
      return 'Review-date column has not been checked yet.';
    case 'NoEligibleColumn':
      return 'No SharePoint review-date column is configured for this library.';
    case 'SingleEligibleColumn':
      return 'A SharePoint date column was found. No column will be used until an administrator explicitly confirms it.';
    case 'MultipleEligibleColumns':
      return 'Multiple SharePoint date columns were found. No column will be used until an administrator explicitly selects one.';
    case 'Active':
      return "SharePoint is now the source of truth for this library's review dates.";
    case 'Stale':
      return 'The previously configured SharePoint review-date column is no longer available, so Knowledge Health has stopped synchronizing review dates from SharePoint.';
  }
}

// Only shown for NoEligibleColumn — the self-service remediation path.
// Never implies Knowledge Health can or will create the column itself.
export const NO_ELIGIBLE_COLUMN_GUIDANCE =
  "You can continue managing review dates manually in Knowledge Health. If you want SharePoint to provide review dates, create a Date and Time column in SharePoint (for example, 'Review Date'), then return here and check again.";

export const CONFIRM_OVERWRITE_WARNING =
  'Once confirmed, SharePoint becomes the source of review dates for documents in this library. Existing manually-entered review dates may be replaced when SharePoint provides a value.';
