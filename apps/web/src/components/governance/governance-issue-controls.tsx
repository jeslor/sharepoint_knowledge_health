'use client';

import { useState } from 'react';
import type { GovernanceIssueResponse, GovernanceIssueStatusValue, UpdateGovernanceIssueRequest } from '@sph/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';

// ADR-0016 §4.5, confirmed on Phase 8B review: the same strict 3-edge
// cycle the API enforces — one legal "next" status per current status.
// Admin/GovernanceManager only — includes the Resolved -> Open (reopen)
// edge, which the self-service exception below deliberately excludes.
const NEXT_STATUS: Record<GovernanceIssueStatusValue, { status: GovernanceIssueStatusValue; label: string } | null> = {
  Open: { status: 'InProgress', label: 'Start progress' },
  InProgress: { status: 'Resolved', label: 'Mark resolved' },
  Resolved: { status: 'Open', label: 'Reopen' },
};

// ADR-0021 §3.6 / ADR-0016 §16.2: the assignee's self-service exception —
// forward-only, no Resolved -> Open edge. A separate table (not a filtered
// view of NEXT_STATUS) so the boundary stays visible on its own, matching
// the same choice already made server-side in governance-issues.service.ts.
const SELF_SERVICE_NEXT_STATUS: Partial<Record<GovernanceIssueStatusValue, { status: GovernanceIssueStatusValue; label: string }>> = {
  Open: { status: 'InProgress', label: 'Start progress' },
  InProgress: { status: 'Resolved', label: 'Mark resolved' },
};

interface GovernanceIssueControlsProps {
  issue: GovernanceIssueResponse;
  assignableUsers: { id: string; displayName: string }[];
  canManage: boolean;
  // ADR-0021 §3.6: true only when the current user is neither Admin nor
  // GovernanceManager but IS this issue's current assignedUserId — a
  // narrower, resource-scoped right, never a role change. Mutually
  // exclusive with canManage by convention (the page computes it that
  // way), but this component doesn't rely on that — canManage always
  // takes the full-rights branch regardless.
  canSelfService: boolean;
  onUpdate: (request: UpdateGovernanceIssueRequest) => Promise<void>;
  saving: boolean;
}

export function GovernanceIssueControls({
  issue,
  assignableUsers,
  canManage,
  canSelfService,
  onUpdate,
  saving,
}: GovernanceIssueControlsProps): JSX.Element {
  const [notes, setNotes] = useState(issue.resolutionNotes ?? '');

  if (!canManage && !canSelfService) {
    return (
      <Card className="text-sm text-slate-600">
        Only an Admin, a Governance Manager, or this issue&apos;s assignee can update it.
      </Card>
    );
  }

  // Backend enforcement is the real boundary (governance-issues.service.ts's
  // assertUpdateAuthorized) — this only decides what the button offers, so
  // a self-service assignee is never even shown the reopen edge or the
  // reassignment control.
  const next = canManage ? NEXT_STATUS[issue.status] : SELF_SERVICE_NEXT_STATUS[issue.status];

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        {next && (
          <Button disabled={saving} onClick={() => void onUpdate({ status: next.status })}>
            {saving ? 'Saving…' : next.label}
          </Button>
        )}

        {canManage && (
          <Field label="Assigned to">
            <Select
              value={issue.assignedUserId ?? ''}
              disabled={saving}
              onChange={(newValue) => void onUpdate({ assignedUserId: newValue || null })}
              options={[
                { value: '', label: 'Unassigned' },
                ...assignableUsers.map((user) => ({ value: user.id, label: user.displayName })),
              ]}
            />
          </Field>
        )}
      </div>

      <label className="flex flex-col text-sm text-slate-600">
        Resolution notes
        <textarea
          className="mt-1 min-h-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors duration-150 ease-premium hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <Button
          variant="secondary"
          size="sm"
          className="mt-2 self-start"
          disabled={saving}
          onClick={() => void onUpdate({ resolutionNotes: notes || null })}
        >
          Save notes
        </Button>
      </label>
    </Card>
  );
}
