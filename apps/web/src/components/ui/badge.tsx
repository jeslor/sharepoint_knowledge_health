import type { ReactNode } from 'react';
import type { FluentIcon } from '@fluentui/react-icons';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'critical';

const TONE_STYLES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  critical: 'bg-red-100 text-red-800',
};

interface BadgeProps {
  tone?: BadgeTone;
  // Escape hatch for callers with their own status->color map (e.g. a
  // status value with no exact tone match) — takes precedence over `tone`
  // when both are supplied, so existing pixel-exact color pairs can move
  // onto this shell without changing their visible output.
  className?: string;
  // Status use case only — one per badge, never decorative.
  icon?: FluentIcon;
  children: ReactNode;
}

export function Badge({ tone, className, icon: Icon, children }: BadgeProps): JSX.Element {
  const toneClass = className ?? (tone ? TONE_STYLES[tone] : TONE_STYLES.neutral);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${toneClass}`}>
      {Icon && <Icon fontSize={12} />}
      {children}
    </span>
  );
}
