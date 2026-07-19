import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  children: ReactNode;
  className?: string;
}

// Wraps the `<label>text<div class="mt-1">control</div></label>` shape
// duplicated across every form in the app — the label's implicit
// association with a descendant input/select/textarea still works through
// the wrapping div, so existing getByLabelText() queries are unaffected.
export function Field({ label, children, className = '' }: FieldProps): JSX.Element {
  return (
    <label className={`flex flex-col text-sm text-slate-600 ${className}`}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
