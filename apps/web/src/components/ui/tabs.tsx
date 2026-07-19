import type { KeyboardEvent } from 'react';

export interface TabDef {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: TabDef[];
  activeId: string;
  onChange: (id: string) => void;
}

// Phase 10A.4: generalized from the tab pattern already hand-built once in
// governance/issues/[issueId]/page.tsx (border-b-2 active indicator).
// Proper tablist semantics + left/right-arrow-key navigation, per the
// design system's accessibility-first principle.
export function Tabs({ tabs, activeId, onChange }: TabsProps): JSX.Element {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (index + delta + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    if (nextTab) onChange(nextTab.id);
  };

  return (
    <div role="tablist" className="flex gap-4 border-b border-slate-200">
      {tabs.map((tab, index) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`-mb-px border-b-2 px-1 pb-2 text-body-strong transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
              active ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
