import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Accordion } from '@/components/ui/accordion';

export interface CriterionCardProps {
  name: string;
  // The real weight from packages/scoring/src/config.ts (SCORING_WEIGHTS) —
  // never invented, always matches ADR-0002/ADR-0025's documented values.
  weight: number;
  measures: ReactNode;
  matters: ReactNode;
  improve: ReactNode;
}

// One scoring criterion: name + its real weight (as a proportional bar, not
// a chart — no charting dependency needed for seven static bars) + the
// three questions the brief asks every criterion to answer, each collapsed
// by default so seven criteria in a row stays scannable.
export function CriterionCard({ name, weight, measures, matters, improve }: CriterionCardProps): JSX.Element {
  return (
    <Card id={`criterion-${name.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-section-title text-slate-900">{name}</h3>
        <Badge tone="info">{weight}% of score</Badge>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${weight}%` }} />
      </div>

      <div className="mt-4">
        <Accordion
          items={[
            { id: 'measures', question: 'What does this measure?', answer: measures },
            { id: 'matters', question: 'Why does this matter?', answer: matters },
            { id: 'improve', question: 'How do I improve it?', answer: improve },
          ]}
        />
      </div>
    </Card>
  );
}
