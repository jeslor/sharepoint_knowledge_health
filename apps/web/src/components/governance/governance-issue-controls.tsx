'use client';

import { useState } from 'react';
import type { GovernanceIssueResponse, GovernanceIssueStatusValue, UpdateGovernanceIssueRequest } from '@sph/types';

// ADR-0016 §4.5, confirmed on Phase 8B review: the same strict 3-edge
// cycle the API enforces — one legal "next" status per current status.
const NEXT_STATUS: Record<GovernanceIssueStatusValue, { status: GovernanceIssueStatusValue; label: string } | null> = {
  Open: { status: 'InProgress', label: 'Start progress' },
  InProgress: { status: 'Resolved', label: 'Mark resolved' },
  Resolved: { status: 'Open', label: 'Reopen' },
};

interface GovernanceIssueControlsProps {
  issue: GovernanceIssueResponse;
  assignableUsers: { id: string; displayName: string }[];
  canManage: boolean;
  onUpdate: (request: UpdateGovernanceIssueRequest) => Promise<void>;
  saving: boolean;
}

export function GovernanceIssueControls({ issue, assignableUsers, canManage, onUpdate, saving }: GovernanceIssueControlsProps): JSX.Element {
  const [notes, setNotes] = useState(issue.resolutionNotes ?? '');

  if (!canManage) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Only an Admin or Governance Manager can update this issue.
      </div>
    );
  }

  const next = NEXT_STATUS[issue.status];

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-4">
        {next && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void onUpdate({ status: next.status })}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : next.label}
          </button>
        )}

        <label className="flex flex-col text-sm text-slate-600">
          Assigned to
          <select
            className="mt-1 rounded-md border border-slate-300 px-2 py-1"
            value={issue.assignedUserId ?? ''}
            disabled={saving}
            onChange={(event) => void onUpdate({ assignedUserId: event.target.value || null })}
          >
            <option value="">Unassigned</option>
            {assignableUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col text-sm text-slate-600">
        Resolution notes
        <textarea
          className="mt-1 min-h-24 rounded-md border border-slate-300 px-2 py-1"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => void onUpdate({ resolutionNotes: notes || null })}
          className="mt-2 self-start rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save notes
        </button>
      </label>
    </div>
  );
}
