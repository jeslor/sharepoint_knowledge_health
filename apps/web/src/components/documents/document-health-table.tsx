import Link from 'next/link';
import type { DocumentHealthResponse } from '@sph/types';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/query-state';
import { TableScrollContainer } from '@/components/ui/table-scroll-container';
import { HealthScoreBadge } from './health-score-badge';
import { ReviewDateHealthBadge } from './review-date-health-badge';

interface DocumentHealthTableProps {
  documents: DocumentHealthResponse[];
  sortDir: 'asc' | 'desc';
  onToggleScoreSort: () => void;
  // P0-5 (ADR-0022 Phase 7): candidate selection for bulk ReviewStatus
  // remediation. Owned by the caller (DocumentsPage), not this table — the
  // Set persists across pagination/filtering exactly like every other piece
  // of page-level state here, so a selection made on one page survives
  // navigating to another.
  selectedDocumentIds: Set<string>;
  onToggleDocument: (documentId: string) => void;
  onToggleSelectAllEligible: () => void;
}

// P0-5: a document is a bulk-remediation candidate for ReviewStatus
// specifically when its current health score actually carries a
// ReviewStatus HealthIssue — the same criterion RemediationService's own
// server-side eligibility re-validation checks (resolveEligibility), read
// here from the same issues array documents.service.ts already populates
// for this response. This is a client-side display hint only; the server
// re-validates regardless (ADR-0022 §8), so a stale/racy read here can
// never mis-create a job for an ineligible document — it can only ever
// under- or over-offer a checkbox the server would reject anyway.
export function isReviewStatusCandidate(document: DocumentHealthResponse): boolean {
  return document.issues.some((issue) => issue.type === 'ReviewStatus');
}

function DocumentCard({
  document,
  selected,
  onToggle,
}: {
  document: DocumentHealthResponse;
  selected: boolean;
  onToggle: () => void;
}): JSX.Element {
  const eligible = isReviewStatusCandidate(document);

  return (
    <div className="rounded-xl border border-slate-200/60 bg-white p-4 shadow-card">
      <div className="flex items-start gap-3">
        <Checkbox
          aria-label={`Select ${document.documentName}`}
          checked={selected}
          disabled={!eligible}
          title={eligible ? undefined : 'Not eligible for Review Status remediation'}
          className="mt-1 shrink-0"
          onChange={() => {
            if (eligible) onToggle();
          }}
        />
        <Link
          href={`/dashboard/documents/${document.documentId}`}
          className="min-w-0 flex-1 text-body-strong text-slate-900 hover:underline"
        >
          {document.documentName}
        </Link>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-slate-100 pt-3 text-body">
        <div className="col-span-2">
          <dt className="text-caption text-slate-500">Site</dt>
          <dd className="truncate text-slate-700">{document.siteName}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-caption text-slate-500">Owner</dt>
          <dd className="text-slate-700">{document.owner ?? 'Unassigned'}</dd>
        </div>
        <div>
          <dt className="text-caption text-slate-500">Health score</dt>
          <dd className="mt-0.5">
            <HealthScoreBadge score={document.score} band={document.band} />
          </dd>
        </div>
        <div>
          <dt className="text-caption text-slate-500">Status</dt>
          <dd className="text-slate-700">{document.status}</dd>
        </div>
        <div>
          <dt className="text-caption text-slate-500">Last modified</dt>
          <dd className="text-slate-700">
            {new Date(document.lastModifiedAt).toLocaleDateString()}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-slate-500">Review date</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <ReviewDateHealthBadge state={document.reviewDateHealth} />
            {document.nextReviewDueAt && (
              <span className="text-caption text-slate-500">
                {new Date(document.nextReviewDueAt).toLocaleDateString()}
              </span>
            )}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-caption text-slate-500">Issues</dt>
          <dd className="text-slate-700">{document.issueCount}</dd>
        </div>
      </dl>
    </div>
  );
}

export function DocumentHealthTable({
  documents,
  sortDir,
  onToggleScoreSort,
  selectedDocumentIds,
  onToggleDocument,
  onToggleSelectAllEligible,
}: DocumentHealthTableProps): JSX.Element {
  if (documents.length === 0) {
    return <EmptyState label="No documents match the current filters." />;
  }

  const eligibleDocuments = documents.filter(isReviewStatusCandidate);
  const allEligibleSelected =
    eligibleDocuments.length > 0 &&
    eligibleDocuments.every((document) => selectedDocumentIds.has(document.documentId));

  return (
    <>
      {/* Below xl: a 9-column table has no good way to stay both readable
          and within a phone or tablet viewport, and 1024px-1279px specifically leaves too little room for it too — packing Document/Site/Owner/
          Score/Status/dates/Issues into columns that thin means either
          crushed text or a table the whole page scrolls sideways to read.
          A card per document keeps every field labeled and readable, in
          the same order the table presents them. */}
      <div className="space-y-3 xl:hidden">
        {eligibleDocuments.length > 0 && (
          <label className="flex items-center gap-2 text-body-strong text-slate-700">
            <Checkbox
              aria-label="Select all rows"
              checked={allEligibleSelected}
              onChange={onToggleSelectAllEligible}
            />
            Select all eligible for remediation
          </label>
        )}
        <ul className="space-y-3">
          {documents.map((document) => (
            <li key={document.documentId}>
              <DocumentCard
                document={document}
                selected={selectedDocumentIds.has(document.documentId)}
                onToggle={() => onToggleDocument(document.documentId)}
              />
            </li>
          ))}
        </ul>
      </div>

      {/* Phase 10A.6 (plan Part 2 §4): whitespace-driven, not line-driven —
          the header keeps a soft, low-contrast separator; ordinary rows
          rely on generous row height + hover background instead of a
          border between every row. Sort mechanism/columns unchanged
          (that's 10C's scope). */}
      <div className="hidden xl:block">
        <TableScrollContainer>
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200/60 text-slate-500">
                <th className="w-8 py-2.5 pr-4 font-medium">
                  <Checkbox
                    aria-label="Select all rows"
                    checked={allEligibleSelected}
                    disabled={eligibleDocuments.length === 0}
                    onChange={onToggleSelectAllEligible}
                  />
                </th>
                <th className="py-2.5 pr-4 font-medium">Document</th>
                <th className="py-2.5 pr-4 font-medium">Site</th>
                <th className="py-2.5 pr-4 font-medium">Owner</th>
                <th className="py-2.5 pr-4 font-medium">
                  <button
                    type="button"
                    onClick={onToggleScoreSort}
                    className="flex items-center gap-1 font-medium transition-colors duration-150 ease-premium hover:text-slate-900"
                  >
                    Health score {sortDir === 'asc' ? '↑' : '↓'}
                  </button>
                </th>
                <th className="py-2.5 pr-4 font-medium">Status</th>
                <th className="py-2.5 pr-4 font-medium">Last modified</th>
                <th className="py-2.5 pr-4 font-medium">Review date</th>
                <th className="py-2.5 pr-4 font-medium">Issues</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => {
                const eligible = isReviewStatusCandidate(document);
                return (
                  <tr
                    key={document.documentId}
                    className="transition-colors duration-150 ease-premium hover:bg-slate-50"
                  >
                    <td className="py-3 pr-4">
                      <Checkbox
                        aria-label={`Select ${document.documentName}`}
                        checked={selectedDocumentIds.has(document.documentId)}
                        disabled={!eligible}
                        title={eligible ? undefined : 'Not eligible for Review Status remediation'}
                        // `disabled` alone isn't a reliable enough guard against
                        // ever selecting an ineligible document — some input
                        // events still reach a disabled control depending on how
                        // they're dispatched. Requirement: never silently select
                        // a document that cannot be remediated, so eligibility is
                        // re-checked here too, not just reflected visually.
                        onChange={() => {
                          if (eligible) onToggleDocument(document.documentId);
                        }}
                      />
                    </td>
                    <td className="py-3 pr-4">
                      <Link
                        href={`/dashboard/documents/${document.documentId}`}
                        className="text-slate-900 hover:underline"
                      >
                        {document.documentName}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{document.siteName}</td>
                    <td className="py-3 pr-4 text-slate-600">{document.owner ?? 'Unassigned'}</td>
                    <td className="py-3 pr-4">
                      <HealthScoreBadge score={document.score} band={document.band} />
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{document.status}</td>
                    <td className="py-3 pr-4 text-slate-600">
                      {new Date(document.lastModifiedAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <ReviewDateHealthBadge state={document.reviewDateHealth} />
                        {document.nextReviewDueAt && (
                          <span className="text-slate-500">
                            {new Date(document.nextReviewDueAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{document.issueCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScrollContainer>
      </div>
    </>
  );
}
