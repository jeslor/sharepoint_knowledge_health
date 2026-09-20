'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GuideNav, type GuideSection } from '@/components/help/guide-nav';
import { MethodologySteps } from '@/components/help/methodology-steps';
import { CriterionCard, type CriterionCardProps } from '@/components/help/criterion-card';
import { NextStepCard } from '@/components/help/next-step-card';
import { TargetArrowRegular, ArrowSyncRegular } from '@fluentui/react-icons';

// The guide's own navigation model — every id here has a matching
// <section id="..."> below, observed by the scroll-spy further down.
const GUIDE_SECTIONS: GuideSection[] = [
  { id: 'introduction', label: 'Introduction' },
  { id: 'discover', label: 'Discover' },
  { id: 'scan', label: 'Scan' },
  { id: 'evaluate', label: 'Health criteria' },
  { id: 'score', label: 'Understanding your score' },
  { id: 'improve', label: 'Fixing issues' },
  { id: 'rescan', label: 'Rescanning' },
];

// The seven real scoring criteria — name, weight, and explanations sourced
// directly from packages/scoring/src/rules/*.ts and ADR-0002/ADR-0025.
// Weights must always sum to 100 and match SCORING_WEIGHTS exactly.
const CRITERIA: CriterionCardProps[] = [
  {
    name: 'Freshness',
    weight: 25,
    measures: <p>How recently the document was last modified in SharePoint.</p>,
    matters: (
      <p>
        A document nobody has touched in a long time is a strong signal that its information may be out of date, even
        if everything else about it looks fine.
      </p>
    ),
    improve: (
      <p>
        Open the document in SharePoint and make an update — a title fix, a formatting pass, a content review, even
        something small. The next scan will pick up the new modified date. Full score for documents modified within
        the last 90 days; the score fades out the longer a document goes untouched, reaching zero at two years.
      </p>
    ),
  },
  {
    name: 'Ownership',
    weight: 20,
    measures: <p>Whether the document has an identifiable owner, and whether that owner is still an active user.</p>,
    matters: (
      <p>
        A document with no clear owner has nobody accountable for keeping it accurate — when it goes stale or needs a
        review, there&apos;s no one to ask.
      </p>
    ),
    improve: (
      <p>
        Assign an owner from the document&apos;s detail page. An owner can come from SharePoint&apos;s own record of
        who created the file, or be assigned manually by an Admin or Governance Manager — either satisfies this
        check, as long as the owner is a real, active person.
      </p>
    ),
  },
  {
    name: 'Review Status',
    weight: 15,
    measures: <p>Whether the document has a scheduled review date, and whether that date has already passed.</p>,
    matters: (
      <p>
        A review date is your organization&apos;s own commitment to revisit a document. Without one, there&apos;s no
        signal that anyone intends to check whether it&apos;s still accurate.
      </p>
    ),
    improve: (
      <p>
        Set a review date from the document&apos;s detail page, or in bulk using the <strong>Remediate review
        status</strong> action on the Documents page. A document with no review date scores lowest; one whose date
        has already passed scores better but still needs attention; a document with a future review date scores
        fully — even if that date is coming up soon (a &quot;Due Soon&quot; badge appears within 30 days of the
        date purely as a heads-up; it does not affect the score).
      </p>
    ),
  },
  {
    name: 'Metadata',
    weight: 15,
    measures: (
      <p>
        Whether the document&apos;s file name looks like a placeholder that was never properly renamed — things like
        &quot;Untitled&quot;, &quot;New document&quot;, &quot;Copy of …&quot;, or a generic auto-numbered name.
      </p>
    ),
    matters: (
      <p>
        A placeholder name usually means the document was never properly finished or organized, making it hard for
        anyone else to know what it is without opening it.
      </p>
    ),
    improve: (
      <p>
        Rename the file in SharePoint to something descriptive. This check looks at the file name only today — not
        tags or descriptions.
      </p>
    ),
  },
  {
    name: 'Duplication',
    weight: 10,
    measures: <p>Whether another document in your organization has the exact same name and file size.</p>,
    matters: (
      <p>
        Exact duplicates fragment your knowledge base — a reader may find and trust an outdated copy while the real,
        current version lives elsewhere.
      </p>
    ),
    improve: (
      <p>
        Compare the copies in SharePoint, decide which is the source of truth, and remove or consolidate the other.
        This is an exact-match check today (identical name and size) — it won&apos;t catch renamed copies or a
        different file format of the same content.
      </p>
    ),
  },
  {
    name: 'Age',
    weight: 5,
    measures: (
      <p>
        How long ago the document was originally created — distinct from Freshness, which looks at when it was last
        modified.
      </p>
    ),
    matters: (
      <p>
        A document can be frequently edited (high Freshness) and still be fundamentally old content that deserves a
        real look at whether it&apos;s still relevant, not just touched up.
      </p>
    ),
    improve: (
      <p>
        Review whether the document is still relevant. If it is, a substantive update keeps it useful; if it&apos;s
        served its purpose, consider archiving or removing it. Full score for documents created within the last
        year; the score fades out over five years.
      </p>
    ),
  },
  {
    name: 'Taxonomy',
    weight: 10,
    measures: (
      <p>Whether the document has values filled in for the classification columns your organization has designated for its library.</p>
    ),
    matters: (
      <p>
        Consistent classification is what makes documents findable and reportable across a large knowledge base — a
        document missing its classification fields is effectively invisible to anyone filtering or searching by
        them.
      </p>
    ),
    improve: (
      <p>
        Fill in the missing classification columns for this document in SharePoint. If a library has no
        classification fields configured at all, this check doesn&apos;t penalize it — an Admin or Governance
        Manager can configure fields for a library from its site page first if you want taxonomy coverage measured
        there.
      </p>
    ),
  },
];

function SectionHeading({ id, eyebrow, title }: { id: string; eyebrow: string; title: string }): JSX.Element {
  return (
    <div>
      <p className="text-caption font-medium uppercase tracking-wider text-brand-600">{eyebrow}</p>
      <h2 id={`${id}-heading`} className="mt-1 text-page-title text-slate-900">
        {title}
      </h2>
    </div>
  );
}

export default function DocumentHealthGuidePage(): JSX.Element {
  const [activeId, setActiveId] = useState(GUIDE_SECTIONS[0]!.id);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    // Guards environments without IntersectionObserver (older browsers,
    // and jsdom in tests) — the guide still renders and works fully via
    // manual jump-to-section clicks, it just won't auto-highlight the
    // active section while scrolling.
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        // Pick whichever intersecting section is closest to the top —
        // stable during fast scrolling, unlike "last entry in the list."
        const topMost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        const id = topMost.target.getAttribute('data-section-id');
        if (id) setActiveId(id);
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    );

    for (const section of GUIDE_SECTIONS) {
      const el = sectionRefs.current[section.id];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  function jumpTo(id: string): void {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function registerRef(id: string) {
    return (el: HTMLElement | null): void => {
      sectionRefs.current[id] = el;
    };
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8 lg:grid-cols-[240px_1fr]">
      {/* No lg:order-* here: relying on order to visually move an item also
          reassigns which grid track it auto-places into (order affects
          placement, not just paint order), which is what previously made
          this item claim the wide 1fr track instead of the narrow one.
          Source order already matches the wanted visual order — nav rail
          on the left, content on the right — so no reordering is needed. */}
      <div>
        <GuideNav sections={GUIDE_SECTIONS} activeId={activeId} onJump={jumpTo} />
      </div>

      <div className="min-w-0 space-y-16">
        {/* Introduction */}
        <section id="introduction" data-section-id="introduction" ref={registerRef('introduction')} className="scroll-mt-8 space-y-6">
          <SectionHeading id="introduction" eyebrow="Document Health Guide" title="How Document Health is measured" />
          <p className="max-w-2xl text-body text-slate-600">
            Every document in your organization is discovered, scanned, and evaluated against seven governance
            criteria to produce a single 0–100 health score. This guide walks through the full pipeline — what gets
            inspected, exactly how the score is calculated, and what to do about the results.
          </p>
          <Card>
            <MethodologySteps />
          </Card>
        </section>

        {/* Discover */}
        <section id="discover" data-section-id="discover" ref={registerRef('discover')} className="scroll-mt-8 space-y-6">
          <SectionHeading id="discover" eyebrow="Step 1" title="Discover" />
          <p className="max-w-2xl text-body text-slate-600">
            The application first discovers the SharePoint sites available to your connected Microsoft 365 tenant,
            using the permissions your Global Administrator granted during setup. Discovery only lists sites and
            libraries — it does not look at any documents yet.
          </p>
          <p className="max-w-2xl text-body text-slate-600">
            A discovered site isn&apos;t scanned automatically. An Admin must explicitly <strong>approve</strong> it
            first — this is a deliberate trust boundary, so nothing is ever scanned without an administrator having
            reviewed and allowed it.
          </p>
          <NextStepCard
            title="Ready to connect your sites?"
            description="Discover the SharePoint sites available to your organization and approve the ones you want monitored."
            href="/dashboard/sharepoint"
            cta="Discover SharePoint sites"
          />
        </section>

        {/* Scan */}
        <section id="scan" data-section-id="scan" ref={registerRef('scan')} className="scroll-mt-8 space-y-6">
          <SectionHeading id="scan" eyebrow="Step 2" title="Scan" />
          <Card>
            <MethodologySteps activeId="scan" />
          </Card>
          <p className="max-w-2xl text-body text-slate-600">
            A scan walks every folder in each approved site and records each document&apos;s <strong>metadata</strong>{' '}
            — its name, file size, created and modified dates, and owner information from Microsoft Graph.
          </p>
          <div className="max-w-2xl rounded-lg border border-slate-200/60 bg-slate-50 p-4 text-body text-slate-700">
            <strong>What a scan does not do:</strong> it never opens, reads, or analyzes the contents of your files.
            Every scoring criterion works from metadata alone — this is a governance tool, not a content-scanning
            one.
          </div>
          <p className="max-w-2xl text-body text-slate-600">
            Scans can be started manually at any time, or run automatically on a daily or weekly schedule.
          </p>
          <NextStepCard
            title="Run your first scan"
            description="Start a scan to collect metadata and health scores for your approved sites."
            href="/dashboard/scans"
            cta="Start a scan"
          />
        </section>

        {/* Evaluate */}
        <section id="evaluate" data-section-id="evaluate" ref={registerRef('evaluate')} className="scroll-mt-8 space-y-6">
          <SectionHeading id="evaluate" eyebrow="Step 3" title="Evaluate" />
          <Card>
            <MethodologySteps activeId="evaluate" />
          </Card>
          <p className="max-w-2xl text-body text-slate-600">
            Every document is evaluated against seven independent criteria. Each produces its own 0–100 sub-score;
            together, weighted, they form the document&apos;s overall health score. Open any criterion below for
            details.
          </p>
          <div className="space-y-4">
            {CRITERIA.map((criterion) => (
              <CriterionCard key={criterion.name} {...criterion} />
            ))}
          </div>
        </section>

        {/* Score */}
        <section id="score" data-section-id="score" ref={registerRef('score')} className="scroll-mt-8 space-y-6">
          <SectionHeading id="score" eyebrow="How it all combines" title="Understanding your score" />
          <p className="max-w-2xl text-body text-slate-600">
            The seven sub-scores combine into a single composite score using the weights shown above — a document
            that scores perfectly on six criteria but poorly on one will still show a lower overall score, since
            every criterion always counts.
          </p>

          <Card>
            <CardHeader title="Document Health Score" icon={TargetArrowRegular} />
            <div className="space-y-2">
              {CRITERIA.map((criterion) => (
                <div key={criterion.name} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-body text-slate-600">{criterion.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-300" style={{ width: `${criterion.weight}%` }} />
                  </div>
                  <span className="w-10 shrink-0 text-right text-caption tabular-nums text-slate-500">{criterion.weight}%</span>
                </div>
              ))}
            </div>
            <div className="mt-6 border-t border-slate-200/60 pt-4">
              <p className="text-body-strong text-slate-800">Overall Health</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone="success">Healthy — 90 to 100</Badge>
                <Badge tone="warning">Needs Attention — 70 to 89</Badge>
                <Badge tone="critical">Requires Review — below 70</Badge>
              </div>
            </div>
          </Card>

          <p className="max-w-2xl text-body text-slate-600">
            Separately, any single criterion that scores below 70 generates an <strong>issue</strong> on that
            document — shown as <Badge tone="warning">Warning</Badge> (score 40–69) or{' '}
            <Badge tone="critical">Critical</Badge> (score below 40) — regardless of the document&apos;s overall
            band. A document can sit in the Healthy range overall while still showing one issue worth a look.
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <p className="text-body-strong text-green-700">Example: a healthy document</p>
              <p className="mt-2 text-body text-slate-600">
                <em>&quot;Q3 Vendor Contract Renewal.docx&quot;</em> — modified 12 days ago, owned by an active
                employee, review date set for next quarter, no duplicates, and every classification field filled in.
                Every criterion scores well, so the composite lands in the Healthy range with no issues raised.
              </p>
            </Card>
            <Card>
              <p className="text-body-strong text-red-700">Example: a document needing attention</p>
              <p className="mt-2 text-body text-slate-600">
                <em>&quot;Copy of Untitled.docx&quot;</em> — created three years ago, no owner on record, and no
                review date set. <strong>Problem:</strong> a placeholder name, no accountable owner, no review
                commitment. <strong>Impact:</strong> Metadata, Ownership, and Review Status all score poorly, pulling
                the composite into Requires Review. <strong>Recommended action:</strong> rename the file, assign an
                owner, and set a review date — each fix raises the score at the next scan.
              </p>
            </Card>
          </div>
        </section>

        {/* Improve */}
        <section id="improve" data-section-id="improve" ref={registerRef('improve')} className="scroll-mt-8 space-y-6">
          <SectionHeading id="improve" eyebrow="Step 5" title="Fixing issues" />
          <Card>
            <MethodologySteps activeId="improve" />
          </Card>
          <p className="max-w-2xl text-body text-slate-600">
            Most fixes happen where the criteria above describe them — renaming a file, assigning an owner, setting a
            review date, or updating classification fields. For <strong>Review Status</strong> issues specifically,
            you can fix many documents at once: select them on the Documents page and use{' '}
            <strong>Remediate review status</strong> to set a new review date in bulk.
          </p>
          <p className="max-w-2xl text-body text-slate-600">
            For ongoing tracking, Governance turns a detected issue into a trackable workflow — assign it to a
            teammate, follow its status through to resolved, and see the history in one place.
          </p>
          <NextStepCard
            title="Ready to improve your document health?"
            description="See every document with an open issue, and act on the ones that need it most."
            href="/dashboard/documents"
            cta="View unhealthy documents"
          />
        </section>

        {/* Rescan */}
        <section id="rescan" data-section-id="rescan" ref={registerRef('rescan')} className="scroll-mt-8 space-y-6">
          <SectionHeading id="rescan" eyebrow="Step 6" title="Rescanning" />
          <Card>
            <MethodologySteps activeId="rescan" />
          </Card>
          <p className="max-w-2xl text-body text-slate-600">
            Nothing updates automatically the moment you fix a document — scores reflect the most recent scan.
            Trigger a new scan manually any time, or rely on your organization&apos;s scheduled cadence (daily or
            weekly) to pick up changes.
          </p>
          <div className="max-w-2xl space-y-2 rounded-lg border border-slate-200/60 bg-slate-50 p-4 text-body text-slate-700">
            <p className="text-body-strong text-slate-800">A few habits that keep scores meaningful:</p>
            <ul className="ml-5 list-disc space-y-1">
              <li>Approve only the sites your organization actually wants governed — an unapproved site is never scanned.</li>
              <li>Fix a batch of documents, then rescan, rather than expecting scores to change instantly.</li>
              <li>Use Governance to track who&apos;s responsible for an issue instead of relying on memory.</li>
              <li>Configure classification fields for a library before expecting Taxonomy to measure anything there.</li>
            </ul>
          </div>
          <NextStepCard
            eyebrow="You're set"
            title="Go start a scan"
            description="Once you've made changes, a fresh scan is what brings your score up to date."
            href="/dashboard/scans"
            cta="Go to Scans"
          />
        </section>

        <div className="flex items-center gap-2 border-t border-slate-200/60 pt-6 text-body text-slate-500">
          <ArrowSyncRegular fontSize={16} />
          <Link href="/dashboard/help" className="text-brand-600 hover:underline">
            Back to Help
          </Link>
        </div>
      </div>
    </div>
  );
}
