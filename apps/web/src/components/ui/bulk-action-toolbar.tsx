import type { ReactNode } from 'react';

interface BulkActionToolbarProps {
  selectedCount: number;
  onClearSelection: () => void;
  // Page-specific action buttons, composed by the caller — this component
  // has no opinion on what the available bulk actions are for any given
  // table (Documents/Governance/Users/Scans all differ).
  children: ReactNode;
}

// Phase 10A.5: appears above a table once at least one row is selected.
// Driven purely by selectedCount/onClearSelection — carries no assumptions
// about the table's data shape, so it's reusable across every list page.
export function BulkActionToolbar({ selectedCount, onClearSelection, children }: BulkActionToolbarProps): JSX.Element | null {
  if (selectedCount === 0) return null;

  return (
    <div className="flex animate-fade-in items-center justify-between gap-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-body-strong text-brand-700">
      <span>
        {selectedCount} selected
        <button
          type="button"
          onClick={onClearSelection}
          className="ml-3 text-body font-normal text-brand-600 underline transition-colors duration-150 hover:text-brand-700"
        >
          Clear
        </button>
      </span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
