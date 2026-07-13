'use client';

import { use } from 'react';
import type { GovernanceIssueTypeValue } from '@sph/types';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { DocumentOwnership } from '@/components/documents/document-ownership';
import { DocumentScoreHistory } from '@/components/documents/document-score-history';
import { SeverityBadge } from '@/components/documents/severity-badge';
import { TrackInGovernanceButton } from '@/components/governance/track-in-governance-button';
import { useDocument } from '@/lib/api/hooks/use-document';
import { useDocumentHistory } from '@/lib/api/hooks/use-document-history';
import { useDocumentOwners } from '@/lib/api/hooks/use-document-owners';
import { useCurrentUser } from '@/lib/auth/current-user-context';

interface DocumentDetailPageProps {
  params: Promise<{ documentId: string }>;
}

export default function DocumentDetailPage({ params }: DocumentDetailPageProps): JSX.Element {
  const { documentId } = use(params);
  const { data: document, loading, error } = useDocument(documentId);
  const { data: history, loading: historyLoading, error: historyError } = useDocumentHistory(documentId);
  const { owners, loading: ownersLoading, error: ownersError, assign, remove, saving: savingOwner } = useDocumentOwners(documentId);
  const { user } = useCurrentUser();

  if (loading) return <LoadingState label="Loading document…" />;
  if (error) return <ErrorState error={error} />;
  if (!document) return <EmptyState label="Document not found." />;

  const canManageGovernance = user?.role === 'Admin' || user?.role === 'GovernanceManager';

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
                <div className="flex items-center justify-between">
                  <SeverityBadge severity={issue.severity} />
                  {canManageGovernance && (
                    <TrackInGovernanceButton documentId={documentId} issueType={issue.type as GovernanceIssueTypeValue} />
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-700">{issue.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="text-sm font-medium text-slate-500">Ownership</h2>
        <div className="mt-2">
          {ownersLoading && <LoadingState label="Loading ownership…" />}
          {ownersError && <ErrorState error={ownersError} />}
          {owners && (
            <DocumentOwnership owners={owners} canManage={canManageGovernance} onAssign={assign} onRemove={remove} saving={savingOwner} />
          )}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-slate-500">Score history</h2>
        <div className="mt-2">
          {historyLoading && <LoadingState label="Loading history…" />}
          {historyError && <ErrorState error={historyError} />}
          {history && <DocumentScoreHistory points={history.points} />}
        </div>
      </div>
    </div>
  );
}
