'use client';

import { useState } from 'react';
import type { AssignDocumentOwnerRequest, DocumentOwnerResponse } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';

interface DocumentOwnershipProps {
  owners: DocumentOwnerResponse[];
  canManage: boolean;
  onAssign: (request: AssignDocumentOwnerRequest) => Promise<void>;
  onRemove: (ownerId: string) => Promise<void>;
  saving: boolean;
}

// ADR-0016 §4.2: source distinguishes worker-owned (GraphMetadata, display
// only) from governance-API-owned (ManualAssignment, removable here).
export function DocumentOwnership({ owners, canManage, onAssign, onRemove, saving }: DocumentOwnershipProps): JSX.Element {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');

  const handleAssign = (): void => {
    void onAssign({ displayName: displayName || null, email: email || null });
    setDisplayName('');
    setEmail('');
  };

  return (
    <div className="space-y-3">
      {owners.length === 0 ? (
        <EmptyState label="No owner information yet." />
      ) : (
        <ul className="space-y-2">
          {owners.map((owner) => (
            <li key={owner.id} className="flex items-center justify-between rounded-md border border-slate-200 p-3 text-sm">
              <div>
                <span className="font-medium text-slate-900">{owner.displayName ?? owner.email ?? 'Unknown'}</span>{' '}
                <span className="text-xs text-slate-500">
                  ({owner.ownerType}, {owner.source === 'ManualAssignment' ? 'manually assigned' : 'from SharePoint'})
                </span>
              </div>
              {canManage && owner.source === 'ManualAssignment' && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void onRemove(owner.id)}
                  className="text-xs font-medium text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
          <label className="flex flex-col text-sm text-slate-600">
            Name
            <input
              type="text"
              className="mt-1 rounded-md border border-slate-300 px-2 py-1"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label className="flex flex-col text-sm text-slate-600">
            Email
            <input
              type="email"
              className="mt-1 rounded-md border border-slate-300 px-2 py-1"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={saving || (!displayName && !email)}
            onClick={handleAssign}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Assign owner'}
          </button>
        </div>
      )}
    </div>
  );
}
