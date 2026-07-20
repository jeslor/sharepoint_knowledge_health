import Link from 'next/link';
import type { DocumentHealthResponse } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';
import { HealthScoreBadge } from './health-score-badge';

interface DocumentHealthTableProps {
  documents: DocumentHealthResponse[];
  sortDir: 'asc' | 'desc';
  onToggleScoreSort: () => void;
}

export function DocumentHealthTable({ documents, sortDir, onToggleScoreSort }: DocumentHealthTableProps): JSX.Element {
  if (documents.length === 0) {
    return <EmptyState label="No documents match the current filters." />;
  }

  // Phase 10A.6 (plan Part 2 §4): whitespace-driven, not line-driven — the
  // header keeps a soft, low-contrast separator; ordinary rows rely on
  // generous row height + hover background instead of a border between
  // every row. Sort mechanism/columns unchanged (that's 10C's scope).
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200/60 text-slate-500">
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
          <th className="py-2.5 pr-4 font-medium">Issues</th>
        </tr>
      </thead>
      <tbody>
        {documents.map((document) => (
          <tr key={document.documentId} className="transition-colors duration-150 ease-premium hover:bg-slate-50">
            <td className="py-3 pr-4">
              <Link href={`/dashboard/documents/${document.documentId}`} className="text-slate-900 hover:underline">
                {document.documentName}
              </Link>
            </td>
            <td className="py-3 pr-4 text-slate-600">{document.siteName}</td>
            <td className="py-3 pr-4 text-slate-600">{document.owner ?? 'Unassigned'}</td>
            <td className="py-3 pr-4">
              <HealthScoreBadge score={document.score} band={document.band} />
            </td>
            <td className="py-3 pr-4 text-slate-600">{document.status}</td>
            <td className="py-3 pr-4 text-slate-600">{new Date(document.lastModifiedAt).toLocaleDateString()}</td>
            <td className="py-3 pr-4 text-slate-600">{document.issueCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
