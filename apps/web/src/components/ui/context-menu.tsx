import {
  Menu as FluentMenu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  FluentProvider,
} from '@fluentui/react-components';
import type { FluentIcon } from '@fluentui/react-icons';
import type { ReactElement } from 'react';
import { brandTheme } from '@/lib/fluent-theme';
import type { MenuItemDef } from './menu';

export type { MenuItemDef };

interface ContextMenuProps {
  trigger: ReactElement;
  items: MenuItemDef[];
}

// Phase 10A.4 (plan Part 3.6): the same Fluent `Menu` as ui/menu.tsx, in its
// right-click (`openOnContext`) trigger mode — Fluent does not export a
// separately-named "ContextMenu" component. Cursor-relative positioning
// with viewport-edge collision avoidance comes from Fluent rather than
// being reimplemented. Built as a primitive; no current page has an
// identified need for right-click actions, so it's not wired in yet.
export function ContextMenu({ trigger, items }: ContextMenuProps): JSX.Element {
  return (
    <FluentProvider theme={brandTheme}>
      <FluentMenu openOnContext>
        <MenuTrigger disableButtonEnhancement>{trigger}</MenuTrigger>
        {/* Phase 10B.4: matches Select/Menu's popup radius/border — see
            ui/menu.tsx for the same treatment and rationale. */}
        <MenuPopover className="rounded-xl border border-slate-200/60">
          <MenuList>
            {items.map((item) => {
              const Icon: FluentIcon | undefined = item.icon;
              return (
                <MenuItem key={item.label} onClick={item.onClick} icon={Icon ? <Icon fontSize={16} /> : undefined}>
                  {item.label}
                </MenuItem>
              );
            })}
          </MenuList>
        </MenuPopover>
      </FluentMenu>
    </FluentProvider>
  );
}
