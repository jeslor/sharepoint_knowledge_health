import type { ReactElement, ReactNode } from 'react';
import { Popover, PopoverSurface, PopoverTrigger, FluentProvider } from '@fluentui/react-components';
import { brandTheme } from '@/lib/fluent-theme';

interface CalloutProps {
  trigger: ReactElement;
  children: ReactNode;
}

// Phase 10A.4 (plan Part 3.6): Fluent-backed `Popover` — anchor positioning
// with collision detection, focus management, and outside-click/Escape
// dismissal come from Fluent rather than being reimplemented. Click-
// triggered by default (not hover-only), for touch/keyboard parity.
export function Callout({ trigger, children }: CalloutProps): JSX.Element {
  return (
    <FluentProvider theme={brandTheme}>
      <Popover>
        <PopoverTrigger disableButtonEnhancement>{trigger}</PopoverTrigger>
        {/* Phase 10B.4: matches Select/Menu's popup radius/border — see
            ui/menu.tsx for the same treatment and rationale. */}
        <PopoverSurface className="rounded-xl border border-slate-200/60">{children}</PopoverSurface>
      </Popover>
    </FluentProvider>
  );
}
