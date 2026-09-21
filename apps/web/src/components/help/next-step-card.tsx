import Link from 'next/link';
import { ArrowRightRegular } from '@fluentui/react-icons';
import { Card } from '@/components/ui/card';

interface NextStepCardProps {
  eyebrow?: string;
  title: string;
  description?: string;
  // Always a real in-app route — never a placeholder/dead-end href.
  href: string;
  cta: string;
}

// The "Your next step" pattern used at the end of every major guide
// section — a brand-tinted card (distinct from the plain white Card used
// for explanatory content) so it reads as an action, not more reading.
export function NextStepCard({ eyebrow = 'Your next step', title, description, href, cta }: NextStepCardProps): JSX.Element {
  return (
    <Card className="border-brand-100 bg-brand-50/60">
      <p className="text-caption font-medium uppercase tracking-wider text-brand-600">{eyebrow}</p>
      <h3 className="mt-1 text-section-title text-slate-900">{title}</h3>
      {description && <p className="mt-1 text-body text-slate-600">{description}</p>}
      <Link
        href={href}
        className="mt-4 inline-flex items-center gap-1.5 text-body-strong text-brand-700 hover:text-brand-800 hover:underline"
      >
        {cta}
        <ArrowRightRegular fontSize={16} />
      </Link>
    </Card>
  );
}
