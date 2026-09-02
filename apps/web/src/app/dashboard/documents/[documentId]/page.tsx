'use client';

import { use } from 'react';
import type { GovernanceIssueTypeValue } from '@sph/types';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/query-state';
import { DocumentOwnership } from '@/components/documents/document-ownership';
import { DocumentReviewDate } from '@/components/documents/document-review-date';
import { DocumentTaxonomyCoverage } from '@/components/documents/document-taxonomy-coverage';
import { DocumentScoreHistory } from '@/components/documents/document-score-history';
import { SeverityBadge } from '@/components/documents/severity-badge';
import { TrackInGovernanceButton } from '@/components/governance/track-in-governance-button';
import { useDocument } from '@/lib/api/hooks/use-document';
import { useDocumentHistory } from '@/lib/api/hooks/use-document-history';
import { useDocumentOwners } from '@/lib/api/hooks/use-document-owners';
import { useDocumentReviewDate } from '@/lib/api/hooks/use-document-review-date';
import { useCurrentUser } from '@/lib/auth/current-user-context';

interface DocumentDetailPageProps {
  params: Promise<{ documentId: string }>;
}

export default function DocumentDetailPage({ params }: DocumentDetailPageProps): JSX.Element {
  const { documentId } = use(params);
  const { data: document, loading, error, refetch } = useDocument(documentId);
  const { data: history, loading: historyLoading, error: historyError } = useDocumentHistory(documentId);
  const { owners, loading: ownersLoading, error: ownersError, assign, remove, saving: savingOwner } = useDocumentOwners(documentId);
  const { setReviewDate, saving: savingReviewDate, saveError: reviewDateError } = useDocumentReviewDate(documentId, refetch);
  const { user } = useCurrentUser();

  if (loading) return <LoadingState label="Loading document…" />;
  if (error) return <ErrorState error={error} />;
  if (!document) return <EmptyState label="Document not found." />;

  const canManageGovernance = user?.role === 'Admin' || user?.role === 'GovernanceManager';

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-page-title text-slate-900">{document.documentName}</h1>
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

      <Card>
        <p className="text-caption text-slate-500">Health score</p>
        <p className="text-metric text-slate-900">{document.score === null ? 'Not yet scored' : `${document.score}/100`}</p>
      </Card>

      <div>
        <h2 className="text-body-strong text-slate-700">Issues</h2>
        {document.issues.length === 0 ? (
          <EmptyState label={document.score === null ? 'No scan has run yet.' : 'No issues — fully healthy.'} />
        ) : (
          <ul className="mt-2 space-y-2">
            {document.issues.map((issue, index) => (
              <li key={`${issue.type}-${index}`} className="rounded-lg border border-slate-200/60 p-3">
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

      <div id="ownership">
        <h2 className="text-body-strong text-slate-700">Ownership</h2>
        <div className="mt-2">
          {ownersLoading && <LoadingState label="Loading ownership…" />}
          {ownersError && <ErrorState error={ownersError} />}
          {owners && (
            <DocumentOwnership owners={owners} canManage={canManageGovernance} onAssign={assign} onRemove={remove} saving={savingOwner} />
          )}
        </div>
      </div>

      <div id="review-date">
        <h2 className="text-body-strong text-slate-700">Scheduled review date</h2>
        <div className="mt-2">
          <DocumentReviewDate
            nextReviewDueAt={document.nextReviewDueAt}
            reviewDateHealth={document.reviewDateHealth}
            reviewDateSource={document.reviewDateSource}
            reviewDateColumnDisplayName={document.reviewDateColumnDisplayName}
            sharePointManaged={document.sharePointManaged}
            sharePointManagedColumnDisplayName={document.sharePointManagedColumnDisplayName}
            canManage={canManageGovernance}
            onSave={setReviewDate}
            saving={savingReviewDate}
            saveError={reviewDateError}
          />
        </div>
      </div>

      <div id="taxonomy-coverage">
        <h2 className="text-body-strong text-slate-700">Classification coverage</h2>
        <div className="mt-2">
          <DocumentTaxonomyCoverage coverage={document.taxonomyCoverage} />
        </div>
      </div>

      <div>
        <h2 className="text-body-strong text-slate-700">Score history</h2>
        <div className="mt-2">
          {historyLoading && <LoadingState label="Loading history…" />}
          {historyError && <ErrorState error={historyError} />}
          {history && <DocumentScoreHistory points={history.points} />}
        </div>
      </div>
    </div>
  );
}
