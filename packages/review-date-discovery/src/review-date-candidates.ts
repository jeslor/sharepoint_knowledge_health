import type { GraphColumnDefinition } from '@sph/graph-client';

// Empirically confirmed via live validation against a real tenant: across
// every real SharePoint document library inspected, these were the only
// dateTime-faceted columns present independent of any customer's own
// column choices. This is not a "which column means review date" guess —
// it's a categorical exclusion of platform-managed fields, the same kind
// of structural exclusion the dateTime-facet filter itself already
// performs for ID/Title/ContentType. Kept as a defensive fallback
// alongside isDeletable below, in case that signal is ever unreliable on
// some tenant/API-version combination.
const SYSTEM_COLUMN_NAMES = new Set(['Created', 'Modified']);

/**
 * Structural, two-layer candidate resolution for review-date column
 * discovery:
 *
 *  - Layer 1: carries Graph's dateTime facet (the one structurally
 *    guaranteed type signal — never a name/displayName match).
 *  - Layer 2: excludes platform-managed system columns. Primary signal is
 *    columnDefinition.isDeletable === false (a column the customer cannot
 *    delete via SharePoint's own UI is definitionally not something they
 *    authored to carry business meaning) — `!== false` deliberately
 *    treats an absent/undefined isDeletable as "not excluded," so a
 *    missing field on some response shape never accidentally excludes a
 *    legitimate customer column. SYSTEM_COLUMN_NAMES is the fallback for
 *    the two specific columns confirmed live to need it regardless.
 *
 * Unions list-level columns with content-type-provisioned columns
 * (deduplicated by columnDefinition.id, since a column can appear in both
 * sets). Zero candidates, one candidate, or many are all valid, meaningful
 * outcomes for a caller to act on differently; this function itself never
 * picks a "best" one, and never involves confidence scoring (a separate,
 * display-only concern — see review-date-confidence.ts).
 */
export function resolveReviewDateCandidates(
  listColumns: GraphColumnDefinition[],
  contentTypeColumns: GraphColumnDefinition[],
): GraphColumnDefinition[] {
  const byId = new Map<string, GraphColumnDefinition>();
  for (const column of [...listColumns, ...contentTypeColumns]) {
    if (!byId.has(column.id)) byId.set(column.id, column);
  }
  return [...byId.values()].filter(
    (column) => column.dateTime !== undefined && column.isDeletable !== false && !SYSTEM_COLUMN_NAMES.has(column.name),
  );
}
