'use client';

import Link from 'next/link';
import type { FluentIcon } from '@fluentui/react-icons';
import {
  RocketRegular,
  TargetArrowRegular,
  WrenchRegular,
  ShieldCheckmarkRegular,
  ArrowRightRegular,
} from '@fluentui/react-icons';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { buttonClassName } from '@/components/ui/button';

interface TopicLink {
  label: string;
  href: string;
}

interface Topic {
  title: string;
  icon: FluentIcon;
  links: TopicLink[];
}

// Every link below is a real in-app route or a real anchor inside
// /dashboard/help/document-health — none of this is aspirational content.
const TOPICS: Topic[] = [
  {
    title: 'Getting Started',
    icon: RocketRegular,
    links: [
      { label: 'What is Document Health?', href: '/dashboard/help/document-health' },
      { label: 'How scanning works', href: '/dashboard/help/document-health#scan' },
      { label: 'Understanding your score', href: '/dashboard/help/document-health#score' },
    ],
  },
  {
    title: 'Understanding the Score',
    icon: TargetArrowRegular,
    links: [
      { label: 'The seven health criteria', href: '/dashboard/help/document-health#evaluate' },
      {
        label: 'How the composite score is calculated',
        href: '/dashboard/help/document-health#score',
      },
      {
        label: 'What Healthy, Needs Attention, and Requires Review mean',
        href: '/dashboard/help/document-health#score',
      },
    ],
  },
  {
    title: 'Improving Your Content',
    icon: WrenchRegular,
    links: [
      { label: 'View and fix unhealthy documents', href: '/dashboard/documents' },
      { label: 'Assigning ownership', href: '/dashboard/help/document-health#criterion-ownership' },
      { label: 'Setting review dates and classification fields', href: '/dashboard/sharepoint' },
    ],
  },
  {
    title: 'Administration',
    icon: ShieldCheckmarkRegular,
    links: [
      { label: 'SharePoint site discovery and approval', href: '/dashboard/sharepoint' },
      { label: 'Scanning and scheduling', href: '/dashboard/scans' },
      { label: 'Notifications', href: '/dashboard/notifications' },
      { label: 'Refresh Microsoft 365 permissions', href: '/dashboard/settings' },
    ],
  },
];

export default function HelpPage(): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <PageHeader
        title="Help & Guide"
        description="Learn how SharePoint Knowledge Health evaluates your documents, what each health criterion means, and how to improve your knowledge base."
      />

      {/* The flagship guide — a prominent, distinct hero card rather than
          just another topic card, since this is the one experience the
          brief calls out as the most important. */}
      <Card className="border-brand-100 bg-gradient-to-br from-brand-50/70 to-white">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-page-title text-slate-900">Understand Document Health</h2>
            <p className="mt-1 max-w-xl text-body text-slate-600">
              See how your SharePoint content is discovered, scanned, evaluated, and scored, then
              find out exactly what to do to improve it.
            </p>
          </div>
          <Link
            href="/dashboard/help/document-health"
            className={buttonClassName('primary', 'md', 'shrink-0')}
          >
            Start the guide
            <ArrowRightRegular fontSize={16} />
          </Link>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {TOPICS.map((topic) => (
          <Card key={topic.title}>
            {/* A local, semantic replacement for CardHeader (which renders
                its title as a plain <div>, not a heading) — matches the
                same visual treatment exactly, but as a real <h2> so screen
                reader users can navigate this page by heading, per this
                feature's accessibility requirement. Scoped to this one new
                page rather than changing the shared CardHeader used
                app-wide. */}
            <div className="-mx-6 -mt-6 mb-4 flex items-center justify-between rounded-t-xl border-b border-slate-200/60 bg-slate-50 px-6 py-3.5">
              <h2 className="flex items-center gap-2.5 text-section-title text-slate-900">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-brand-600">
                  <topic.icon fontSize={16} />
                </span>
                {topic.title}
              </h2>
            </div>
            <ul className="space-y-2.5">
              {topic.links.map((link) => (
                <li key={link.href + link.label}>
                  <Link
                    href={link.href}
                    className="text-body-strong text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-brand-700 hover:decoration-brand-400"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
