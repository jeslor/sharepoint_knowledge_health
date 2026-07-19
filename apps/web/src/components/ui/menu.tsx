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

export interface MenuItemDef {
  label: string;
  onClick: () => void;
  icon?: FluentIcon;
}

interface MenuProps {
  trigger: ReactElement;
  items: MenuItemDef[];
}

// Phase 10A.4 (plan Part 3.6): Fluent-backed — roving-tabindex keyboard nav,
// collision-aware anchor positioning, and outside-click/Escape dismissal
// come from Fluent's Menu rather than being reimplemented. Serves both
// "dropdown menu" and "overflow menu" (trigger a MoreHorizontalRegular icon
// button). Locally scoped FluentProvider contains Griffel's styling to
// exactly this subtree.
export function Menu({ trigger, items }: MenuProps): JSX.Element {
  return (
    <FluentProvider theme={brandTheme}>
      <FluentMenu>
        <MenuTrigger disableButtonEnhancement>{trigger}</MenuTrigger>
        <MenuPopover>
          <MenuList>
            {items.map((item) => {
              const Icon = item.icon;
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
