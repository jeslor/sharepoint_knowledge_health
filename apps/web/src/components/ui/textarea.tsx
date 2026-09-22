import type { TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

// Same height/radius/border/focus language as Input (ui/input.tsx) —
// height is min-h- rather than fixed since a textarea, unlike Input, is
// meant to grow with its `rows` prop.
export function Textarea({ invalid = false, className = '', ...props }: TextareaProps): JSX.Element {
  const invalidClass = invalid
    ? 'border-red-300 hover:border-red-400 focus-visible:ring-red-500'
    : 'border-slate-300 hover:border-slate-400 focus-visible:ring-brand-600';

  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={`min-h-24 rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors duration-150 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${invalidClass} ${className}`}
      {...props}
    />
  );
}
