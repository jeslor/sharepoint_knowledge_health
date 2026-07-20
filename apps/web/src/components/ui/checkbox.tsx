import type { InputHTMLAttributes } from 'react';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  // Required, not optional — a table-row checkbox has no visible text next
  // to it, so every usage must supply its own accessible name (e.g.
  // "Select Handbook.docx" or "Select all rows") rather than shipping
  // unlabeled by default.
  'aria-label': string;
}

// Phase 10A.5: generic row-selection control — no assumptions about what
// it's selecting. `accent-color` (not `text-*`) is what native checkboxes
// use for their checked-state fill in modern browsers.
export function Checkbox({ className = '', ...props }: CheckboxProps): JSX.Element {
  return (
    <input
      type="checkbox"
      className={`h-4 w-4 rounded border-slate-300 accent-brand-600 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1 ${className}`}
      {...props}
    />
  );
}
