import { Badge } from '@/components/ui/badge';
import { REVIEW_DATE_STATUS_LABEL, REVIEW_DATE_STATUS_TONE, type ReviewDateLibraryStatus } from './review-date-status';

// Label + tone together, never color alone — REVIEW_DATE_STATUS_LABEL's
// text is what actually communicates the state; tone only reinforces it.
export function ReviewDateStatusBadge({ status }: { status: ReviewDateLibraryStatus }): JSX.Element {
  return <Badge tone={REVIEW_DATE_STATUS_TONE[status.kind]}>{REVIEW_DATE_STATUS_LABEL[status.kind]}</Badge>;
}
