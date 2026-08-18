'use client';

import { useEffect, useRef, useState } from 'react';
import { ErrorState } from '@/components/ui/query-state';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Toast } from '@/components/ui/toast';

interface DocumentReviewDateProps {
  nextReviewDueAt: string | null;
  // Phase 2: 'GraphMetadata' when SharePoint is the source, 'Manual' (or
  // null, for a document with no review date history yet) otherwise —
  // never rendered as the raw enum value, only through the two fixed
  // "Source: ..." sentences below.
  reviewDateSource: string | null;
  reviewDateColumnDisplayName: string | null;
  // Phase 3A-1 (ADR-0016 §17.4): true whenever this document's LIBRARY has
  // an Active SharePoint mapping right now — independent of
  // reviewDateSource, which only reflects this document's own last sync.
  // When true, the manual editor must never render: it would either be
  // rejected by the API's own 409 guard, or (worse) appear to succeed and
  // then be silently overwritten by the next scan.
  sharePointManaged: boolean;
  sharePointManagedColumnDisplayName: string | null;
  canManage: boolean;
  onSave: (nextReviewDueAt: string | null) => Promise<void>;
  saving: boolean;
  saveError: Error | undefined;
}

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

// Mirrors document-ownership.tsx's shape (local form state + a canManage
// gate around the mutating controls) rather than inventing a new pattern.
// ADR-0016 §4.6/§7 / ADR-0021 §3.6: review-date changes stay Admin/
// GovernanceManager-only — the assignee self-service exception never
// extends here, so this component takes canManageGovernance exactly as
// the page already computes it, never a self-service variant.
export function DocumentReviewDate({
  nextReviewDueAt,
  reviewDateSource,
  reviewDateColumnDisplayName,
  sharePointManaged,
  sharePointManagedColumnDisplayName,
  canManage,
  onSave,
  saving,
  saveError,
}: DocumentReviewDateProps): JSX.Element {
  const [dateInput, setDateInput] = useState(toDateInputValue(nextReviewDueAt));
  const [showSavedToast, setShowSavedToast] = useState(false);
  const wasSaving = useRef(false);

  useEffect(() => {
    setDateInput(toDateInputValue(nextReviewDueAt));
  }, [nextReviewDueAt]);

  useEffect(() => {
    if (wasSaving.current && !saving && !saveError) {
      setShowSavedToast(true);
    }
    wasSaving.current = saving;
  }, [saving, saveError]);

  const handleSave = (): void => {
    void onSave(dateInput ? new Date(dateInput).toISOString() : null);
  };

  const handleClear = (): void => {
    void onSave(null);
  };

  const unchanged = dateInput === toDateInputValue(nextReviewDueAt);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        {nextReviewDueAt
          ? `Next review due ${new Date(nextReviewDueAt).toLocaleDateString()}.`
          : 'No review date scheduled.'}
      </p>
      <p className="text-xs text-slate-500">
        {reviewDateSource === 'GraphMetadata'
          ? `Source: SharePoint${reviewDateColumnDisplayName ? ` · ${reviewDateColumnDisplayName}` : ''}`
          : 'Source: Manually managed'}
      </p>

      {sharePointManaged ? (
        // Phase 3A-1: never a competing manual control here — SharePoint
        // is authoritative for this library right now (ADR-0016 §17.1/
        // §17.4). Shown instead of the editor regardless of canManage,
        // since manually editing here would do nothing durable.
        <p className="text-sm text-slate-500">
          This library&apos;s review dates are managed by SharePoint
          {sharePointManagedColumnDisplayName ? ` via the "${sharePointManagedColumnDisplayName}" column` : ''}.
          Update the value directly in SharePoint, or ask an administrator to remove the mapping to manage this
          document&apos;s review date manually again.
        </p>
      ) : (
        <>
          {canManage && (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Scheduled review date">
                  <Input type="date" value={dateInput} disabled={saving} onChange={(event) => setDateInput(event.target.value)} />
                </Field>
                <Button size="sm" disabled={saving || unchanged} onClick={handleSave}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                {nextReviewDueAt && (
                  <Button variant="ghost" size="sm" disabled={saving} onClick={handleClear}>
                    Clear
                  </Button>
                )}
              </div>
              <p className="text-xs text-slate-500">
                This is the next date the document should be reviewed. Saving does not immediately resolve the governance
                issue — the next scan must confirm the review date is set before the issue is verified as fixed.
              </p>
              {saveError && <ErrorState error={saveError} />}
            </>
          )}

          {!canManage && (
            // Closes the self-service dead end: a Member arriving here via a
            // ReviewStatus issue's remediation guidance previously found the
            // control simply absent, with no explanation. The read-only
            // summary line above stays visible either way — this doesn't gate
            // anything, it only explains the existing, unchanged boundary.
            <p className="text-sm text-slate-500">
              Setting the review date requires Admin or Governance Manager permissions. Please contact your administrator.
            </p>
          )}
        </>
      )}

      {showSavedToast && <Toast message="Review date saved." onDismiss={() => setShowSavedToast(false)} />}
    </div>
  );
}
