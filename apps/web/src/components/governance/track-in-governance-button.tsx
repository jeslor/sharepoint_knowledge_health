'use client';

import { useRouter } from 'next/navigation';
import type { GovernanceIssueTypeValue } from '@sph/types';
import { useCreateGovernanceIssue } from '@/lib/api/hooks/use-create-governance-issue';

interface TrackInGovernanceButtonProps {
  documentId: string;
  issueType: GovernanceIssueTypeValue;
}

// ADR-0016 §4.1: the lazy-creation moment — a GovernanceIssue only comes
// into existence once a human takes this first action on a raw,
// scan-produced HealthIssue finding.
export function TrackInGovernanceButton({ documentId, issueType }: TrackInGovernanceButtonProps): JSX.Element {
  const router = useRouter();
  const { create, creating, error } = useCreateGovernanceIssue();

  const handleClick = async (): Promise<void> => {
    try {
      const issue = await create({ documentId, issueType });
      router.push(`/dashboard/governance/issues/${issue.id}`);
    } catch {
      // error state is already surfaced via the hook's `error` field
    }
  };

  return (
    <div>
      <button
        type="button"
        disabled={creating}
        onClick={() => void handleClick()}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {creating ? 'Opening…' : 'Track in governance'}
      </button>
      {error && <p className="mt-1 text-xs text-red-700">{error.message}</p>}
    </div>
  );
}
