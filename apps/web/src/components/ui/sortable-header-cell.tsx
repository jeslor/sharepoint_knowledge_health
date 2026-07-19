import { ArrowSortDownRegular, ArrowSortRegular, ArrowSortUpRegular } from '@fluentui/react-icons';

export type SortDirection = 'asc' | 'desc' | null;

interface SortableHeaderCellProps {
  label: string;
  // null = not currently sorted by this column.
  direction: SortDirection;
  onSort: () => void;
  className?: string;
}

// Phase 10A.5: a generic sortable `<th>` — any column label, any sort
// state, caller-supplied onSort. No assumptions about the table's columns,
// so the same component serves Documents/Scans/Governance/Users tables.
// Icon-based sort affordance replaces the unicode ↑/↓ text from before
// Phase 10A. Sticky-header/band styling (Part 3.7) is a per-table
// convention applied via `className`, not hardcoded here — not every
// header cell in a row is sortable (e.g. a checkbox or actions column).
export function SortableHeaderCell({ label, direction, onSort, className = '' }: SortableHeaderCellProps): JSX.Element {
  const Icon = direction === 'asc' ? ArrowSortUpRegular : direction === 'desc' ? ArrowSortDownRegular : ArrowSortRegular;
  const ariaSort = direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none';

  return (
    <th scope="col" aria-sort={ariaSort} className={`text-caption font-medium uppercase tracking-wide text-slate-500 ${className}`}>
      <button
        type="button"
        onClick={onSort}
        className="flex items-center gap-1 transition-colors duration-150 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      >
        {label}
        <Icon fontSize={14} className={direction ? 'text-brand-600' : 'text-slate-400'} />
      </button>
    </th>
  );
}
