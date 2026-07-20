'use client';

import { useRouter } from 'next/navigation';
import type { GovernanceIssueTypeValue } from '@sph/types';
import { useCreateGovernanceIssue } from '@/lib/api/hooks/use-create-governance-issue';
import { Button } from '@/components/ui/button';

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
      <Button variant="secondary" size="sm" disabled={creating} onClick={() => void handleClick()}>
        {creating ? 'Opening…' : 'Track in governance'}
      </Button>
      {error && <p className="mt-1 text-xs text-red-700">{error.message}</p>}
    </div>
  );
}
