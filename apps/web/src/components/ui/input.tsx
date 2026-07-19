import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  // Phase 10B.3: opt-in soft-red error treatment — not wired to any page
  // yet (form errors currently render as a separate message below the
  // field), but the primitive itself should support it without every
  // caller inventing its own error styling later.
  invalid?: boolean;
}

// Phase 10B.1: height/radius/border language shared exactly with Button
// and Select (h-10, rounded-lg, border-slate-300) so the three controls
// align perfectly in a form row or toolbar.
export function Input({ invalid = false, className = '', ...props }: InputProps): JSX.Element {
  const invalidClass = invalid
    ? 'border-red-300 hover:border-red-400 focus-visible:ring-red-500'
    : 'border-slate-300 hover:border-slate-400 focus-visible:ring-brand-600';

  return (
    <input
      aria-invalid={invalid || undefined}
      className={`h-10 rounded-lg border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 transition-colors duration-150 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${invalidClass} ${className}`}
      {...props}
    />
  );
}
