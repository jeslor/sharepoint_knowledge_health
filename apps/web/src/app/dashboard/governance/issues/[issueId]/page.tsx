'use client';

import { use } from 'react';
import Link from 'next/link';
import { SeverityBadge } from '@/components/documents/severity-badge';
import { GovernanceIssueControls } from '@/components/governance/governance-issue-controls';
import { GovernanceStatusBadge } from '@/components/governance/governance-status-badge';
import { ErrorState, LoadingState } from '@/components/ui/query-state';
import { useAssignableUsers } from '@/lib/api/hooks/use-assignable-users';
import { useGovernanceIssue } from '@/lib/api/hooks/use-governance-issue';
import { useCurrentUser } from '@/lib/auth/current-user-context';

interface GovernanceIssueDetailPageProps {
  params: Promise<{ issueId: string }>;
}

export default function GovernanceIssueDetailPage({ params }: GovernanceIssueDetailPageProps): JSX.Element {
  const { issueId } = use(params);
  const { issue, loading, error, update, updating, updateError } = useGovernanceIssue(issueId);
  const { data: assignableUsers } = useAssignableUsers();
  const { user } = useCurrentUser();

  if (loading) return <LoadingState label="Loading governance issue…" />;
  if (error) return <ErrorState error={error} />;
  if (!issue) return <ErrorState error={new Error('Governance issue not found.')} />;

  const canManage = user?.role === 'Admin' || user?.role === 'GovernanceManager';

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{issue.documentName}</h1>
          <GovernanceStatusBadge status={issue.status} />
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-slate-600">
          <dt className="font-medium text-slate-500">Site</dt>
          <dd>{issue.siteName}</dd>
          <dt className="font-medium text-slate-500">Issue type</dt>
          <dd>{issue.issueType}</dd>
          <dt className="font-medium text-slate-500">Severity</dt>
          <dd>
            <SeverityBadge severity={issue.severity} />
          </dd>
          <dt className="font-medium text-slate-500">Assigned to</dt>
          <dd>{issue.assignedUserName ?? 'Unassigned'}</dd>
          <dt className="font-medium text-slate-500">Still detected</dt>
          <dd>{issue.stillDetected ? 'Yes — the latest scan still reports this issue' : 'No — not seen in the latest scan'}</dd>
          <dt className="font-medium text-slate-500">Opened</dt>
          <dd>{new Date(issue.createdAt).toLocaleString()}</dd>
          {issue.resolvedAt && (
            <>
              <dt className="font-medium text-slate-500">Resolved</dt>
              <dd>{new Date(issue.resolvedAt).toLocaleString()}</dd>
            </>
          )}
        </dl>
        {issue.resolutionNotes && (
          <p className="mt-2 rounded-md bg-slate-50 p-3 text-sm text-slate-700">{issue.resolutionNotes}</p>
        )}
      </div>

      <GovernanceIssueControls
        issue={issue}
        assignableUsers={assignableUsers ?? []}
        canManage={canManage}
        onUpdate={update}
        saving={updating}
      />
      {updateError && <ErrorState error={updateError} />}

      <Link href={`/dashboard/documents/${issue.documentId}`} className="text-sm font-medium text-slate-900 underline">
        View document details and historical scans
      </Link>
    </div>
  );
}
