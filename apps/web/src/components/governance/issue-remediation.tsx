import Link from 'next/link';
import type { GovernanceIssueTypeValue } from '@sph/types';
import { ISSUE_GUIDANCE } from './issue-guidance';

interface IssueRemediationProps {
  documentId: string;
  issueType: GovernanceIssueTypeValue;
  documentWebUrl: string | null;
}

// Priority 7 of the remediation-loop plan: the most direct action
// available for this specific issue type — not a generic "remediation
// action" abstraction, just a static guidance lookup (issue-guidance.ts)
// plus a link that differs by where the fix actually happens.
export function IssueRemediation({ documentId, issueType, documentWebUrl }: IssueRemediationProps): JSX.Element {
  const guidance = ISSUE_GUIDANCE[issueType];

  return (
    <div className="mt-4 rounded-lg border border-slate-200/60 bg-slate-50 p-3">
      <h2 className="text-body-strong text-slate-700">What to do</h2>
      <p className="mt-1 text-sm text-slate-700">{guidance.text}</p>

      {guidance.remediation === 'ownership' && (
        <Link
          href={`/dashboard/documents/${documentId}#ownership`}
          className="mt-2 inline-block text-body-strong text-brand-600 transition-colors duration-150 ease-premium hover:text-brand-700 hover:underline"
        >
          Go to ownership
        </Link>
      )}

      {guidance.remediation === 'reviewDate' && (
        <Link
          href={`/dashboard/documents/${documentId}#review-date`}
          className="mt-2 inline-block text-body-strong text-brand-600 transition-colors duration-150 ease-premium hover:text-brand-700 hover:underline"
        >
          Set review date
        </Link>
      )}

      {guidance.remediation === 'external' &&
        (documentWebUrl ? (
          <a
            href={documentWebUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-body-strong text-brand-600 transition-colors duration-150 ease-premium hover:text-brand-700 hover:underline"
          >
            Open in SharePoint
          </a>
        ) : (
          <p className="mt-2 text-xs text-slate-500">
            SharePoint link is not available yet — it will appear after this document&apos;s next scan.
          </p>
        ))}
    </div>
  );
}
