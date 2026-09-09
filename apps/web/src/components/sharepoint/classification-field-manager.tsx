'use client';

import { useState } from 'react';
import type { ClassificationFieldResponse, ClassificationLibraryResponse } from '@sph/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/query-state';
import { useClassificationCandidates } from '@/lib/api/hooks/use-classification-candidates';
import { useClassificationFieldMutations } from '@/lib/api/hooks/use-classification-field-mutations';

interface ClassificationFieldManagerProps {
  siteId: string;
  libraries: ClassificationLibraryResponse[];
  canManage: boolean;
  onChanged: () => void;
}

/**
 * ADR-0025: lets an Admin/GovernanceManager designate which SharePoint
 * columns make up the organization's classification scheme, per library.
 * These designated columns are what taxonomy coverage measures — a document
 * is "classified" to the extent its library's designated columns are
 * populated. Deliberately NOT a Term Store editor, taxonomy-value editor,
 * or auto-classifier; it only records which columns count.
 */
export function ClassificationFieldManager({ siteId, libraries, canManage, onChanged }: ClassificationFieldManagerProps): JSX.Element {
  if (libraries.length === 0) {
    return <EmptyState label="This site has no document libraries." />;
  }

  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        Designate the SharePoint columns that make up your organization&apos;s classification scheme. Taxonomy coverage measures whether
        these columns are populated on each document — it does not validate the values themselves.
      </p>
      <ul className="divide-y divide-slate-200">
        {libraries.map((library) => (
          <ClassificationLibraryRow
            key={library.graphListId}
            siteId={siteId}
            library={library}
            canManage={canManage}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </div>
  );
}

interface ClassificationLibraryRowProps {
  siteId: string;
  library: ClassificationLibraryResponse;
  canManage: boolean;
  onChanged: () => void;
}

function ClassificationLibraryRow({ siteId, library, canManage, onChanged }: ClassificationLibraryRowProps): JSX.Element {
  const { candidates, loading, error: candidatesError, load } = useClassificationCandidates(siteId, library.graphListId);
  const { designate, remove, saving, error: mutationError } = useClassificationFieldMutations();
  const [adding, setAdding] = useState(false);
  const [selectedColumnId, setSelectedColumnId] = useState('');

  const designatedIds = new Set(library.fields.map((field) => field.columnDefinitionId));
  const available = (candidates ?? []).filter((column) => !designatedIds.has(column.id));

  const handleStartAdd = (): void => {
    setAdding(true);
    void load();
  };

  const handleDesignate = async (): Promise<void> => {
    if (!selectedColumnId) return;
    const created = await designate(siteId, library.graphListId, selectedColumnId);
    if (created) {
      setAdding(false);
      setSelectedColumnId('');
      onChanged();
    }
  };

  const handleRemove = async (fieldId: string): Promise<void> => {
    const ok = await remove(siteId, fieldId);
    if (ok) onChanged();
  };

  return (
    <li className="py-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-slate-900">Library: {library.name}</p>
        {canManage && !adding && (
          <Button size="sm" variant="secondary" onClick={handleStartAdd}>
            Add classification field
          </Button>
        )}
      </div>

      {library.fields.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">
          No classification fields configured — taxonomy coverage is not measured for documents in this library.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {library.fields.map((field) => (
            <ClassificationFieldRow key={field.id} field={field} canManage={canManage} saving={saving} onRemove={handleRemove} />
          ))}
        </ul>
      )}

      {canManage && adding && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {loading ? (
            <span className="text-xs text-slate-500">Loading columns…</span>
          ) : (
            <>
              <label className="sr-only" htmlFor={`classification-column-${library.graphListId}`}>
                Column to designate
              </label>
              <select
                id={`classification-column-${library.graphListId}`}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                value={selectedColumnId}
                onChange={(event) => setSelectedColumnId(event.target.value)}
              >
                <option value="">Select a column…</option>
                {available.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.displayName}
                  </option>
                ))}
              </select>
              <Button size="sm" disabled={!selectedColumnId || saving} onClick={handleDesignate}>
                {saving ? 'Saving…' : 'Designate'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              {available.length === 0 && !loading && (
                <span className="text-xs text-slate-500">All available columns are already designated.</span>
              )}
            </>
          )}
        </div>
      )}

      {candidatesError && <p className="mt-1 text-xs text-red-700">{candidatesError.message}</p>}
      {mutationError && <p className="mt-1 text-xs text-red-700">{mutationError.message}</p>}
    </li>
  );
}

interface ClassificationFieldRowProps {
  field: ClassificationFieldResponse;
  canManage: boolean;
  saving: boolean;
  onRemove: (fieldId: string) => void;
}

function ClassificationFieldRow({ field, canManage, saving, onRemove }: ClassificationFieldRowProps): JSX.Element {
  const isStale = field.status === 'Stale';
  return (
    <li className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-800">{field.columnDisplayName}</span>
        <Badge tone={isStale ? 'warning' : 'success'}>{isStale ? 'Stale' : 'Active'}</Badge>
        {isStale && (
          <span className="text-xs text-slate-500">Column no longer found in SharePoint — excluded from coverage until it returns.</span>
        )}
      </div>
      {canManage && (
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => onRemove(field.id)}>
          Remove
        </Button>
      )}
    </li>
  );
}
