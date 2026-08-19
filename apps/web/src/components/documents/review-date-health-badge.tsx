import type { ReviewDateHealthState } from '@sph/types';
import { Badge } from '@/components/ui/badge';
import { REVIEW_DATE_HEALTH_LABEL, REVIEW_DATE_HEALTH_TONE } from './review-date-health';

// Mirrors ReviewDateStatusBadge (apps/web/src/components/sharepoint/) —
// label + tone together, never color alone.
export function ReviewDateHealthBadge({ state }: { state: ReviewDateHealthState }): JSX.Element {
  return <Badge tone={REVIEW_DATE_HEALTH_TONE[state]}>{REVIEW_DATE_HEALTH_LABEL[state]}</Badge>;
}
