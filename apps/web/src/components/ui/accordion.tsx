'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDownRegular } from '@fluentui/react-icons';

export interface AccordionItemDef {
  id: string;
  question: string;
  answer: ReactNode;
}

interface AccordionItemProps {
  item: AccordionItemDef;
  open: boolean;
  onToggle: (id: string) => void;
}

function AccordionItem({ item, open, onToggle }: AccordionItemProps): JSX.Element {
  const panelId = `accordion-panel-${item.id}`;
  const buttonId = `accordion-button-${item.id}`;
  return (
    <div className="border-b border-slate-200/60 last:border-b-0">
      <h3 className="m-0">
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onToggle(item.id)}
          className="flex w-full items-center justify-between gap-3 rounded py-3 text-left text-body-strong text-slate-800 transition-colors duration-150 ease-premium hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          {item.question}
          <ChevronDownRegular
            fontSize={18}
            className={`shrink-0 text-slate-400 transition-transform duration-150 ease-premium ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </h3>
      {open && (
        <div id={panelId} role="region" aria-labelledby={buttonId} className="pb-4 text-body text-slate-600">
          {item.answer}
        </div>
      )}
    </div>
  );
}

interface AccordionProps {
  items: AccordionItemDef[];
  // Which items start open — defaults to none, so the page stays scannable
  // rather than dumping every answer on first render.
  defaultOpenIds?: string[];
}

// A plain, dependency-free accordion (native <button aria-expanded> +
// conditional render) matching this library's existing hand-rolled
// components (ui/tabs.tsx) rather than introducing Radix/shadcn. Each item
// opens/closes independently (not single-open-at-a-time) — appropriate for
// "answer a few of these, skip the rest" reference content.
export function Accordion({ items, defaultOpenIds = [] }: AccordionProps): JSX.Element {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(defaultOpenIds));

  function toggle(id: string): void {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      {items.map((item) => (
        <AccordionItem key={item.id} item={item} open={openIds.has(item.id)} onToggle={toggle} />
      ))}
    </div>
  );
}
