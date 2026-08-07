/**
 * Every marker a demo-seeded row can be identified by — used for BOTH
 * idempotency (does this row already exist?) and cleanup (reset.ts).
 *
 * Deliberately not a schema change: no model here gained a new column for
 * this. Instead:
 * - Document/SharePointSite/User rows are tagged via an internal,
 *   never-rendered identifier field they already have (graphItemId,
 *   graphSiteId, entraObjectId) — none of these are ever shown in the UI,
 *   so a recognizable prefix doesn't compromise how the demo looks, only
 *   how it's queried by tooling.
 * - AuditLog/GovernanceActivity/Notification rows are tagged via their
 *   existing `metadata: Json?` column (AuditLog, GovernanceActivity) or,
 *   for Notification (no metadata column), inferred entirely from
 *   belonging to a demo-tagged Document/GovernanceIssue — see reset.ts.
 *
 * Visible content (document names, user display names, messages) is
 * deliberately realistic-looking, not prefixed with anything like
 * "[DEMO]" — the whole point is a convincing demo, and every marker below
 * lives in a field the UI never displays.
 */

export const SEED_TAG = 'sph-demo-seed-v1';

export const DEMO_SITE_GRAPH_ID = 'demo-seed-site-001';
export const DEMO_SITE_DISPLAY_NAME = 'Corporate Knowledge Base';

export const DEMO_DOC_GRAPH_ID_PREFIX = 'demo-seed-doc-';

export const DEMO_ASSIGNEE_ENTRA_ID = 'demo-seed-user-assignee';
export const DEMO_ASSIGNEE_EMAIL = 'jordan.lee@demo.internal';
export const DEMO_ASSIGNEE_NAME = 'Jordan Lee';

export const DEMO_PENDING_USER_ENTRA_ID = 'demo-seed-user-pending';
export const DEMO_PENDING_USER_EMAIL = 'morgan.taylor@demo.internal';
export const DEMO_PENDING_USER_NAME = 'Morgan Taylor';

export const DEMO_SCAN_ID_PREFIX = 'demo-seed-scan-';

// A plain marker object merged into every seed-created AuditLog/
// GovernanceActivity `metadata` field — cheap to query
// (`metadata: { path: ['seedTag'], equals: SEED_TAG }` via Prisma's JSON
// filtering) without needing a dedicated column.
export function seedMetadata(extra?: Record<string, unknown>): Record<string, unknown> {
  return { seedTag: SEED_TAG, ...extra };
}
