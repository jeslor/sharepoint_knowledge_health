import { CheckmarkCircleFilled, ArrowRightRegular } from '@fluentui/react-icons';

export interface GuideSection {
  id: string;
  label: string;
}

interface GuideNavProps {
  sections: GuideSection[];
  activeId: string;
  onJump: (id: string) => void;
}

function statusFor(sections: GuideSection[], activeId: string, id: string): 'done' | 'current' | 'upcoming' {
  const activeIndex = sections.findIndex((s) => s.id === activeId);
  const index = sections.findIndex((s) => s.id === id);
  if (index < activeIndex) return 'done';
  if (index === activeIndex) return 'current';
  return 'upcoming';
}

function SectionList({ sections, activeId, onJump }: GuideNavProps): JSX.Element {
  return (
    <ol className="space-y-1">
      {sections.map((section) => {
        const status = statusFor(sections, activeId, section.id);
        return (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => onJump(section.id)}
              aria-current={status === 'current' ? 'true' : undefined}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-body-strong transition-colors duration-150 ease-premium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${
                status === 'current' ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {status === 'done' && <CheckmarkCircleFilled fontSize={16} className="shrink-0 text-brand-600" />}
              {status === 'current' && <ArrowRightRegular fontSize={16} className="shrink-0 text-brand-700" />}
              {status === 'upcoming' && (
                <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-slate-300" aria-hidden="true" />
              )}
              <span className="flex-1">{section.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// Guide progress + jump navigation (✓ done / → current / ○ upcoming, per the
// brief). Desktop: a sticky sidebar list. Mobile/tablet: a native <details>
// dropdown showing the current section, expanding to the same list — same
// data, no separate mobile component, no new dependency.
export function GuideNav({ sections, activeId, onJump }: GuideNavProps): JSX.Element {
  const activeLabel = sections.find((s) => s.id === activeId)?.label ?? sections[0]?.label ?? '';
  const activeIndex = sections.findIndex((s) => s.id === activeId);

  return (
    <>
      <nav aria-label="Guide sections" className="hidden lg:sticky lg:top-8 lg:block">
        <p className="px-3 pb-2 text-caption font-medium uppercase tracking-wider text-slate-400">Document Health Guide</p>
        <SectionList sections={sections} activeId={activeId} onJump={onJump} />
      </nav>

      <details className="rounded-xl border border-slate-200/60 bg-white shadow-card lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-body-strong text-slate-800 marker:content-none">
          <span>
            Section {activeIndex + 1} of {sections.length}: {activeLabel}
          </span>
          <span className="text-caption text-brand-600">Jump to…</span>
        </summary>
        <div className="border-t border-slate-200/60 p-2">
          <SectionList sections={sections} activeId={activeId} onJump={onJump} />
        </div>
      </details>
    </>
  );
}
