'use client';

import type { ReviewDateEligibilityColumn } from '@sph/types';
import { Badge } from '@/components/ui/badge';

const CONFIDENCE_LABEL: Record<ReviewDateEligibilityColumn['confidence'], string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  // Phase 3A-1: "review" is present in the name, but nothing indicates a
  // date (e.g. "Document Review") — flagged distinctly so an admin knows
  // to look closer, never silently folded into "low".
  ambiguous: 'Uncertain — please verify',
};

const CONFIDENCE_TONE: Record<ReviewDateEligibilityColumn['confidence'], 'success' | 'info' | 'neutral' | 'warning'> = {
  high: 'success',
  medium: 'info',
  low: 'neutral',
  ambiguous: 'warning',
};

interface ReviewDateCandidateSelectorProps {
  candidates: ReviewDateEligibilityColumn[];
  selectedId: string | null;
  onSelect: (columnDefinitionId: string) => void;
}

// Required, unselected-by-default radio group — native <input type="radio">
// so it's keyboard-operable and screen-reader-announced by default, not a
// custom clickable div. Confirm (rendered by the parent dialog) stays
// disabled until selectedId is non-null; nothing here ever pre-selects a
// candidate.
export function ReviewDateCandidateSelector({ candidates, selectedId, onSelect }: ReviewDateCandidateSelectorProps): JSX.Element {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-700">Select the SharePoint column to use</legend>
      {candidates.map((candidate) => (
        <label
          key={candidate.id}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50"
        >
          <input
            type="radio"
            name="review-date-candidate"
            className="mt-1"
            checked={selectedId === candidate.id}
            onChange={() => onSelect(candidate.id)}
          />
          <span className="flex-1">
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-900">{candidate.displayName}</span>
              <Badge tone={CONFIDENCE_TONE[candidate.confidence]}>{CONFIDENCE_LABEL[candidate.confidence]}</Badge>
            </span>
            {/* Internal name shown only as secondary technical detail, never the primary label. */}
            <span className="text-xs text-slate-500">Internal name: {candidate.name}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
