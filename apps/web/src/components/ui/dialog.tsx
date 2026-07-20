import type { ReactNode } from 'react';
import {
  Dialog as FluentDialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  FluentProvider,
} from '@fluentui/react-components';
import { brandTheme } from '@/lib/fluent-theme';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}

// Phase 10A.4 (plan Part 3.6): Fluent-backed, not hand-rolled — focus-trap
// with restore-to-trigger, Escape, backdrop dismiss, and full ARIA wiring
// come from Fluent's Dialog rather than being reimplemented. Locally scoped
// FluentProvider (see plan §3) contains Griffel's styling to exactly this
// subtree; callers only ever import this file, never
// `@fluentui/react-components` directly.
export function Dialog({ open, onOpenChange, title, children, actions }: DialogProps): JSX.Element {
  return (
    <FluentProvider theme={brandTheme}>
      <FluentDialog open={open} onOpenChange={(_event, data) => onOpenChange(data.open)}>
        {/* Phase 10B.4: matches Select/Menu/Callout's popup radius/border —
            see ui/menu.tsx for the same treatment and rationale. */}
        <DialogSurface className="rounded-xl">
          <DialogBody>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>{children}</DialogContent>
            {actions && <DialogActions>{actions}</DialogActions>}
          </DialogBody>
        </DialogSurface>
      </FluentDialog>
    </FluentProvider>
  );
}
