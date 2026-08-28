'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/query-state';

interface RemediationConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onConfirm: (nextReviewDueAt: string) => void;
  submitting: boolean;
  submitError: Error | undefined;
}

// P0-6 (ADR-0022 Phase 7): mirrors ReviewDateConfirmDialog's shape exactly
// (open/onOpenChange/onConfirm/confirming→submitting/confirmError→submitError)
// rather than inventing a new dialog contract. issueType is always
// 'ReviewStatus' here — P0-5's candidate selection only ever offers
// documents with a current ReviewStatus issue, so there is nothing to pick.
export function RemediationConfirmDialog({
  open,
  onOpenChange,
  selectedCount,
  onConfirm,
  submitting,
  submitError,
}: RemediationConfirmDialogProps): JSX.Element {
  const [dateInput, setDateInput] = useState('');

  // Same "closing without a successful confirm resets the form" precedent
  // as review-date-library-list.tsx's handleDialogOpenChange — this dialog
  // stays mounted (its `open` prop just toggles Fluent's visibility), so a
  // fresh date field on every re-open avoids carrying a stale value in from
  // a previously cancelled attempt.
  useEffect(() => {
    if (open) setDateInput('');
  }, [open]);

  const confirmDisabled = submitting || dateInput === '';

  const handleConfirm = (): void => {
    if (confirmDisabled) return;
    onConfirm(new Date(dateInput).toISOString());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!submitting) onOpenChange(nextOpen);
      }}
      title="Remediate review status"
      actions={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={confirmDisabled}>
            {submitting ? 'Remediating…' : 'Remediate'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-700">
          {selectedCount} document{selectedCount === 1 ? '' : 's'} will have {selectedCount === 1 ? 'its' : 'their'} next
          review date set to the date below, resolving the Review Status issue once the change is confirmed.
        </p>

        <Field label="New review due date">
          <Input type="date" value={dateInput} disabled={submitting} onChange={(event) => setDateInput(event.target.value)} />
        </Field>

        {submitError && <ErrorState error={submitError} />}
      </div>
    </Dialog>
  );
}
