import type { ClassificationFieldInput } from '@sph/scoring';
import type { SharePointClassificationField } from '@sph/database';
import type { GraphColumnDefinition } from '@sph/graph-client';

/**
 * ADR-0025: a raw SharePoint field value counts as "populated" only if it
 * carries actual content. Presence only — the value's correctness is never
 * inspected (V1 is coverage, not validity). Treated as NOT populated:
 * null/undefined, empty string, whitespace-only string, empty array, and an
 * empty object (Graph sometimes represents an unset lookup/taxonomy field as
 * `{}`). Any other non-empty value (including 0 and false, which are
 * legitimately "set") counts as populated.
 */
export function isClassificationValuePopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

/**
 * Resolves an active classification field to the live Graph column that
 * backs it, by the stable columnDefinitionId (never the display name). A
 * field whose column no longer resolves is stale — returned in `staleIds`
 * so the caller can transition it and exclude it from the denominator,
 * exactly as review-date sync handles a vanished mapped column.
 */
export function resolveActiveColumns(
  activeFields: Pick<SharePointClassificationField, 'id' | 'columnDefinitionId' | 'columnDisplayNameAtConfirmation'>[],
  liveColumns: GraphColumnDefinition[],
): {
  resolved: { fieldId: string; columnDefinitionId: string; columnName: string; displayName: string }[];
  staleIds: string[];
} {
  const byId = new Map(liveColumns.map((column) => [column.id, column]));
  const resolved: { fieldId: string; columnDefinitionId: string; columnName: string; displayName: string }[] = [];
  const staleIds: string[] = [];

  for (const field of activeFields) {
    const column = byId.get(field.columnDefinitionId);
    if (!column) {
      staleIds.push(field.id);
      continue;
    }
    resolved.push({
      fieldId: field.id,
      columnDefinitionId: field.columnDefinitionId,
      columnName: column.name,
      // Live display name, falling back to the confirmation snapshot — same
      // provenance/fallback rule as review-date sync.
      displayName: column.displayName || field.columnDisplayNameAtConfirmation,
    });
  }

  return { resolved, staleIds };
}

/**
 * Builds the per-document ClassificationFieldInput[] the scoring rule
 * consumes, from the resolved active columns and this document's raw field
 * values (keyed by the column's internal name). A document with no row in
 * the value map (e.g. not a list-item-backed file) yields every field as
 * not populated — a real, measured "uncovered", distinct from D=0.
 */
export function buildClassificationFieldInputs(
  resolvedColumns: { columnDefinitionId: string; columnName: string; displayName: string }[],
  fieldValues: Record<string, unknown> | undefined,
): ClassificationFieldInput[] {
  return resolvedColumns.map((column) => ({
    columnDefinitionId: column.columnDefinitionId,
    displayName: column.displayName,
    populated: isClassificationValuePopulated(fieldValues?.[column.columnName]),
  }));
}
