'use client';

import { useState } from 'react';
import type { ReviewDateEligibilityResponse } from '@sph/types';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/query-state';
import { ReviewDateCandidateSelector } from './review-date-candidate-selector';
import { CONFIRM_OVERWRITE_WARNING } from './review-date-status';

type ConfirmableEligibility = Extract<
  ReviewDateEligibilityResponse,
  { status: 'SingleEligibleColumn' } | { status: 'MultipleEligibleColumns' }
>;

interface ReviewDateConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eligibility: ConfirmableEligibility;
  onConfirm: (columnDefinitionId?: string) => Promise<void>;
  confirming: boolean;
  confirmError: Error | undefined;
}

// The one place SharePoint-becomes-source-of-truth activation happens.
// The overwrite warning is always rendered directly in the dialog body,
// above the actions — never a tooltip, never a collapsed/secondary panel
// — so it's read before Confirm can be reached, in both the single- and
// multiple-candidate flows.
export function ReviewDateConfirmDialog({
  open,
  onOpenChange,
  eligibility,
  onConfirm,
  confirming,
  confirmError,
}: ReviewDateConfirmDialogProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const isMultiple = eligibility.status === 'MultipleEligibleColumns';
  // Single-candidate case: nothing to choose, Confirm is reachable
  // immediately. Multiple-candidate case: Confirm stays disabled until an
  // explicit selection is made — never automatically chosen.
  const confirmDisabled = confirming || (isMultiple && !selectedId);

  const handleConfirm = (): void => {
    const columnDefinitionId = isMultiple ? (selectedId ?? undefined) : eligibility.column.id;
    void onConfirm(columnDefinitionId);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Confirm SharePoint review-date column"
      actions={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={confirmDisabled}>
            {confirming ? 'Confirming…' : 'Confirm'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {!isMultiple && (
          <p className="text-sm text-slate-700">
            Knowledge Health found a SharePoint column that looks like a review-date field:{' '}
            <span className="font-medium">{eligibility.column.displayName}</span>.
          </p>
        )}
        {isMultiple && (
          <ReviewDateCandidateSelector candidates={eligibility.columns} selectedId={selectedId} onSelect={setSelectedId} />
        )}
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {CONFIRM_OVERWRITE_WARNING}
        </p>
        {confirmError && <ErrorState error={confirmError} />}
      </div>
    </Dialog>
  );
}
