import type { ReviewDateHealthState } from '@sph/types';
import type { BadgeTone } from '@/components/ui/badge';

// Phase 3A-1 (ADR-0002 amendment): the API already returns the
// authoritative classification (documents.service.ts, via @sph/scoring's
// classifyReviewDateHealth) — this module only maps that value to a label
// and a tone, mirroring review-date-status.ts's existing LABEL/TONE
// convention for the sibling SharePoint-mapping status. No classification
// logic is re-derived here.
export const REVIEW_DATE_HEALTH_LABEL: Record<ReviewDateHealthState, string> = {
  Missing: 'Missing',
  Overdue: 'Overdue',
  DueSoon: 'Due Soon',
  Healthy: 'Healthy',
};

// Missing (no cadence ever set) reads as the more severe state than
// Overdue (a cadence exists, it's lapsed) — matching the 0-vs-50 scoring
// order ADR-0002's amendment already establishes. DueSoon is
// deliberately not a warning tone: nothing is wrong yet (ADR-0002: "Due
// Soon is explicitly NOT a scored state"), so it gets its own, calmer
// `info` tone rather than sharing Overdue's `warning`.
export const REVIEW_DATE_HEALTH_TONE: Record<ReviewDateHealthState, BadgeTone> = {
  Missing: 'critical',
  Overdue: 'warning',
  DueSoon: 'info',
  Healthy: 'success',
};
