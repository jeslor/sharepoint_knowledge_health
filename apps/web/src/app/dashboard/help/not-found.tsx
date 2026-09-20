import Link from 'next/link';
import { DocumentSearchRegular } from '@fluentui/react-icons';
import { Card } from '@/components/ui/card';
import { buttonClassName } from '@/components/ui/button';

// Next.js convention (app/dashboard/help/not-found.tsx) — renders for any
// unmatched route under /dashboard/help/**, e.g. a stale or hand-typed
// guide link. Kept inside the dashboard shell (same header/nav/auth as
// every other page here), consistent with the rest of the app rather than
// a generic framework 404.
export default function HelpNotFound(): JSX.Element {
  return (
    <Card className="mx-auto flex max-w-md flex-col items-center gap-3 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
        <DocumentSearchRegular fontSize={24} className="text-slate-400" />
      </span>
      <h1 className="text-section-title text-slate-900">We couldn&apos;t find that help topic</h1>
      <p className="text-body text-slate-600">
        The page you&apos;re looking for may have moved. Start from the Help overview to find what you need.
      </p>
      <Link href="/dashboard/help" className={buttonClassName('primary', 'md')}>
        Back to Help
      </Link>
    </Card>
  );
}
