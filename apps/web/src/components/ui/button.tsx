import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { FluentIcon } from '@fluentui/react-icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

// Phase 10B.1/10B.3 (shared-component consistency pass): primary moves to
// the brand accent — the earlier "kept dark-slate, revisit at the 10B
// checkpoint" note (Phase 10A.2) is now resolved now that the dashboard
// exists and the brand color has a real, confident presence to match.
// 10B.3: secondary's hover tints toward brand (not plain gray) so it reads
// as part of the same accent language as primary, just quieter.
const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700',
  ghost: 'text-slate-700 hover:bg-slate-100',
  danger: 'border border-red-300 text-red-700 hover:bg-red-50',
};

// Fixed heights (not padding-derived) so Button/Input/Select align
// perfectly when placed side by side in a toolbar or form row.
const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3',
  md: 'h-10 px-4',
};

// Exported so a non-<button> element that needs to look exactly like a
// Button (e.g. a Next.js <Link> used as a navigational call-to-action) can
// reuse the same classes instead of duplicating the style strings.
export function buttonClassName(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className = ''): string {
  return `inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-[color,background-color,border-color,transform] duration-150 ease-premium active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${VARIANT_STYLES[variant]} ${SIZE_STYLES[size]} ${className}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  // Reserved for the "important action" icon use case (Start scan, Assign
  // owner, Sign out) — not meant to be added to every button.
  icon?: FluentIcon;
  children?: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', icon: Icon, className = '', children, ...props }: ButtonProps): JSX.Element {
  return (
    <button type="button" className={buttonClassName(variant, size, className)} {...props}>
      {Icon && <Icon fontSize={16} />}
      {children}
    </button>
  );
}
