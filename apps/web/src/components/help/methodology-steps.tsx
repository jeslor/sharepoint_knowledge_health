import { CheckmarkCircleFilled } from '@fluentui/react-icons';

export interface MethodologyStep {
  id: string;
  label: string;
}

// The real pipeline order (worker-pipeline.md / ADR-0014 / ADR-0002): sites
// are discovered and approved, a scan walks approved sites and upserts
// document metadata, each document is evaluated against the seven scoring
// criteria, a weighted composite score is produced, an administrator acts on
// the resulting issues, and the next scheduled or manual scan re-evaluates
// the result. Six real stages, not an invented onboarding checklist.
export const METHODOLOGY_STEPS: MethodologyStep[] = [
  { id: 'discover', label: 'Discover' },
  { id: 'scan', label: 'Scan' },
  { id: 'evaluate', label: 'Evaluate' },
  { id: 'score', label: 'Score' },
  { id: 'improve', label: 'Improve' },
  { id: 'rescan', label: 'Rescan' },
];

// A static pipeline diagram (not an interactive wizard — MethodologySteps
// only visualizes "how the six stages relate," GuideNav owns actual
// section navigation/progress). `activeId` optionally highlights the stage
// the reader is currently on when this is embedded inline in a section.
export function MethodologySteps({ activeId }: { activeId?: string }): JSX.Element {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-4">
      {METHODOLOGY_STEPS.map((step, index) => {
        const isActive = step.id === activeId;
        const isPast = activeId ? METHODOLOGY_STEPS.findIndex((s) => s.id === activeId) > index : false;
        return (
          <li key={step.id} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-body-strong ${
                  isActive
                    ? 'bg-brand-600 text-white'
                    : isPast
                      ? 'bg-brand-50 text-brand-700'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {isPast ? <CheckmarkCircleFilled fontSize={18} /> : index + 1}
              </span>
              <span className={`text-body-strong ${isActive ? 'text-slate-900' : 'text-slate-600'}`}>{step.label}</span>
            </div>
            {index < METHODOLOGY_STEPS.length - 1 && <span className="mx-1 h-px w-6 shrink-0 bg-slate-300" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
