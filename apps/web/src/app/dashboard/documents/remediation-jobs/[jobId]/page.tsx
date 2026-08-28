'use client';

import { use } from 'react';
import Link from 'next/link';
import { RemediationJobDetailView } from '@/components/documents/remediation-job-detail-view';

interface RemediationJobDetailPageProps {
  params: Promise<{ jobId: string }>;
}

// Thin composition wrapper (frontend-rules.md: "Pages handle composition.
// Components handle presentation.") — RemediationJobDetailView owns the
// actual rendering/data-fetching and is what's unit-tested directly; this
// file's only job is unwrapping the Next.js 15 dynamic-segment param.
export default function RemediationJobDetailPage({ params }: RemediationJobDetailPageProps): JSX.Element {
  const { jobId } = use(params);

  return (
    <div className="space-y-6">
      <RemediationJobDetailView jobId={jobId} />
      <Link
        href="/dashboard/documents/remediation-jobs"
        className="block text-body-strong text-brand-600 transition-colors duration-150 ease-premium hover:text-brand-700 hover:underline"
      >
        Back to remediation history
      </Link>
    </div>
  );
}
