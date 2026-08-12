'use client';

import { useState } from 'react';
import type { AssignDocumentOwnerRequest, DocumentOwnerResponse } from '@sph/types';
import { EmptyState } from '@/components/ui/query-state';
import { Button } from '@/components/ui/button';
import { CommandBar } from '@/components/ui/command-bar';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

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
            <li key={owner.id} className="flex items-center justify-between rounded-lg border border-slate-200/60 p-3 text-sm">
              <div>
                <span className="font-medium text-slate-900">{owner.displayName ?? owner.email ?? 'Unknown'}</span>{' '}
                <span className="text-xs text-slate-500">
                  ({owner.ownerType}, {owner.source === 'ManualAssignment' ? 'manually assigned' : 'from SharePoint'})
                </span>
              </div>
              {canManage && owner.source === 'ManualAssignment' && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => void onRemove(owner.id)}
                  className="text-red-700 hover:bg-red-50 hover:underline"
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <CommandBar>
          <Field label="Name">
            <Input type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Button size="sm" disabled={saving || (!displayName && !email)} onClick={handleAssign}>
            {saving ? 'Saving…' : 'Assign owner'}
          </Button>
        </CommandBar>
      ) : (
        // Closes the self-service dead end: a Member arriving here via an
        // Ownership issue's remediation guidance previously found the
        // control simply absent, with no explanation. Read-only
        // information above stays visible either way — this doesn't gate
        // anything, it only explains the existing, unchanged boundary.
        <p className="text-sm text-slate-500">
          Setting the owner requires Admin or Governance Manager permissions. Please contact your administrator.
        </p>
      )}
    </div>
  );
}
