'use client';

import { use } from 'react';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { SeverityBadge } from '@/components/documents/severity-badge';
import { useDocument } from '@/lib/api/hooks/use-document';

interface DocumentDetailPageProps {
  params: Promise<{ documentId: string }>;
}

export default function DocumentDetailPage({ params }: DocumentDetailPageProps): JSX.Element {
  const { documentId } = use(params);
  const { data: document, loading, error } = useDocument(documentId);

  if (loading) return <LoadingState label="Loading document…" />;
  if (error) return <ErrorState error={error} />;
  if (!document) return <EmptyState label="Document not found." />;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{document.documentName}</h1>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-slate-600">
          <dt className="font-medium text-slate-500">Location</dt>
          <dd>
            {document.siteName} / {document.path}
          </dd>
          <dt className="font-medium text-slate-500">Owner</dt>
          <dd>{document.owner ?? 'Unassigned'}</dd>
          <dt className="font-medium text-slate-500">Modified</dt>
          <dd>{new Date(document.sourceModifiedAt).toLocaleString()}</dd>
          <dt className="font-medium text-slate-500">Status</dt>
          <dd>{document.status}</dd>
        </dl>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-500">Health score</p>
        <p className="text-3xl font-semibold text-slate-900">{document.score === null ? 'Not yet scored' : `${document.score}/100`}</p>
      </div>

      <div>
        <h2 className="text-sm font-medium text-slate-500">Issues</h2>
        {document.issues.length === 0 ? (
          <EmptyState label={document.score === null ? 'No scan has run yet.' : 'No issues — fully healthy.'} />
        ) : (
          <ul className="mt-2 space-y-2">
            {document.issues.map((issue, index) => (
              <li key={`${issue.type}-${index}`} className="rounded-md border border-slate-200 p-3">
                <SeverityBadge severity={issue.severity} />
                <p className="mt-1 text-sm text-slate-700">{issue.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
