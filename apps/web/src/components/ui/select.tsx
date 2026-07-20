'use client';

import { Dropdown, FluentProvider, Option } from '@fluentui/react-components';
import type { OptionOnSelectData, SelectionEvents } from '@fluentui/react-components';
import { brandTheme } from '@/lib/fluent-theme';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  id?: string;
}

// Phase 10B.2: a genuine custom dropdown — Fluent's Dropdown/Option under
// the hood (the same hybrid-Fluent pattern already used for Dialog/Menu/
// Callout, per plan Part 3.6), themed to this app's brand tokens via
// FluentProvider. Native <select> can't deliver a styled floating popup,
// hover states, a selected-item indicator, or an open animation — exactly
// the "hard interaction complexity" that pattern exists for.
//
// API note: this is a deliberate, scoped exception to "don't change
// primitive APIs" (confirmed with the user) — moves from native-select
// shape (JSX <option> children, onChange(event)) to an options-array shape
// (onChange(value)), because a real custom dropdown needs to render and
// theme its own option list rather than a browser-native popup. Every
// existing call site was updated to match; no page's filtering/workflow
// logic changed, only how each dropdown declares its options.
export function Select({ value, onChange, options, placeholder, disabled, className = '', ...rest }: SelectProps): JSX.Element {
  const selectedOption = options.find((option) => option.value === value);

  return (
    <FluentProvider theme={brandTheme} className={className}>
      <Dropdown
        className="w-full"
        disabled={disabled}
        placeholder={placeholder}
        value={selectedOption?.label ?? ''}
        selectedOptions={value ? [value] : []}
        onOptionSelect={(_event: SelectionEvents, data: OptionOnSelectData) => onChange(data.optionValue ?? '')}
        // Phase 10B.3: the popup is a genuinely floating layer (Layer 2 in
        // this app's own depth model — the same tier as Menu/Callout/
        // Dialog/Toast), so it gets `shadow-md` + a soft border/radius —
        // not `shadow-card` (reserved for static Layer 1 surfaces). The
        // `listbox` slot is Fluent's supported override point for the
        // popup surface specifically (distinct from the trigger root).
        listbox={{ className: 'rounded-xl border border-slate-200/60 shadow-md' }}
        {...rest}
      >
        {options.map((option) => (
          <Option key={option.value} value={option.value}>
            {option.label}
          </Option>
        ))}
      </Dropdown>
    </FluentProvider>
  );
}
