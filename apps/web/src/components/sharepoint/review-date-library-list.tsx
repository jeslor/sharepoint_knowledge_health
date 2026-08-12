'use client';

import { useState } from 'react';
import type { ReviewDateLibraryResponse } from '@sph/types';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/query-state';
import { useReviewDateEligibility } from '@/lib/api/hooks/use-review-date-eligibility';
import { useConfirmReviewDateMapping } from '@/lib/api/hooks/use-confirm-review-date-mapping';
import { ReviewDateStatusBadge } from './review-date-status-badge';
import { ReviewDateConfirmDialog } from './review-date-confirm-dialog';
import { deriveReviewDateLibraryStatus, reviewDateStatusExplanation, NO_ELIGIBLE_COLUMN_GUIDANCE } from './review-date-status';

interface ReviewDateLibraryListProps {
  siteId: string;
  libraries: ReviewDateLibraryResponse[];
  canManage: boolean;
  onMappingChanged: () => void;
}

export function ReviewDateLibraryList({ siteId, libraries, canManage, onMappingChanged }: ReviewDateLibraryListProps): JSX.Element {
  if (libraries.length === 0) {
    return <EmptyState label="This site has no document libraries." />;
  }

  return (
    <ul className="divide-y divide-slate-200">
      {libraries.map((library) => (
        <ReviewDateLibraryRow
          key={library.graphListId}
          siteId={siteId}
          library={library}
          canManage={canManage}
          onMappingChanged={onMappingChanged}
        />
      ))}
    </ul>
  );
}

interface ReviewDateLibraryRowProps {
  siteId: string;
  library: ReviewDateLibraryResponse;
  canManage: boolean;
  onMappingChanged: () => void;
}

function ReviewDateLibraryRow({ siteId, library, canManage, onMappingChanged }: ReviewDateLibraryRowProps): JSX.Element {
  const { result: eligibility, checking, checkError, check } = useReviewDateEligibility(siteId, library.graphListId);
  const { confirm, confirming, confirmError } = useConfirmReviewDateMapping();
  const [dialogOpen, setDialogOpen] = useState(false);
  // Set only by "Choose replacement column" on a Stale mapping — while
  // true, the row judges its state purely from the freshly-checked
  // eligibility result, not the (still Stale, until the parent refetches)
  // mapping. This is what lets a fresh column become confirmable without
  // the row getting stuck showing "Stale" forever. Never set any other
  // way, and never itself confirms anything automatically — confirmation
  // still requires the same explicit dialog interaction as any other
  // candidate.
  const [remediatingStale, setRemediatingStale] = useState(false);

  const status =
    remediatingStale && eligibility
      ? deriveReviewDateLibraryStatus(null, eligibility)
      : deriveReviewDateLibraryStatus(library.mapping, eligibility);

  const handleCheck = (): void => {
    void check();
  };

  const handleChooseReplacement = (): void => {
    setRemediatingStale(true);
    void check();
  };

  const handleConfirm = async (columnDefinitionId?: string): Promise<void> => {
    const mapping = await confirm(siteId, library.graphListId, columnDefinitionId);
    if (mapping) {
      setDialogOpen(false);
      setRemediatingStale(false);
      onMappingChanged();
    }
  };

  // Closing without a successful confirm (Cancel, Escape, backdrop click)
  // falls back to showing Stale again — nothing was actually rebound, so
  // the row must not claim otherwise.
  const handleDialogOpenChange = (open: boolean): void => {
    setDialogOpen(open);
    if (!open) setRemediatingStale(false);
  };

  return (
    <li className="py-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-900">Library: {library.name}</p>
          <ReviewDateStatusBadge status={status} />
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            {status.kind === 'NotChecked' && (
              <Button size="sm" variant="secondary" disabled={checking} onClick={handleCheck}>
                {checking ? 'Checking…' : 'Check for a review-date column'}
              </Button>
            )}
            {(status.kind === 'SingleEligibleColumn' || status.kind === 'MultipleEligibleColumns') && (
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                Confirm
              </Button>
            )}
            {status.kind === 'Stale' && (
              <Button size="sm" variant="secondary" disabled={checking} onClick={handleChooseReplacement}>
                {checking ? 'Checking…' : 'Choose replacement column'}
              </Button>
            )}
          </div>
        )}
      </div>

      <p className="mt-1 text-xs text-slate-500">{reviewDateStatusExplanation(status)}</p>

      {status.kind === 'NoEligibleColumn' && <p className="mt-1 text-xs text-slate-500">{NO_ELIGIBLE_COLUMN_GUIDANCE}</p>}

      {status.kind === 'Active' && (
        <p className="mt-1 text-xs text-slate-500">
          Review date column: {status.mapping.columnDisplayName}
          {status.mapping.confirmedByDisplayName ? ` · Confirmed by ${status.mapping.confirmedByDisplayName}` : ''}
        </p>
      )}

      {checkError && <p className="mt-1 text-xs text-red-700">{checkError.message}</p>}

      {(status.kind === 'SingleEligibleColumn' || status.kind === 'MultipleEligibleColumns') && (
        <ReviewDateConfirmDialog
          open={dialogOpen}
          onOpenChange={handleDialogOpenChange}
          eligibility={status.eligibility}
          onConfirm={handleConfirm}
          confirming={confirming}
          confirmError={confirmError}
        />
      )}
    </li>
  );
}
