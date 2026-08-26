import type { SortDirection } from './documents';

/**
 * ADR-0019: organization-wide administrative action history. Sibling of
 * GovernanceActivity (governance.ts), not a replacement — see the
 * AuditLog model's own doc comment in prisma/schema.prisma for the
 * boundary between the two.
 *
 * A closed set today, matching exactly the writers Phase 11 wires in — not
 * an exhaustive enum, since `action` is a plain string column (ADR-0019's
 * own tradeoff: "a small, code-reviewed, closed set in practice even
 * though the column itself is a plain string"). Extending this list for a
 * future action is additive, not a schema change.
 */
export type AuditLogAction =
  | 'user.approved'
  | 'user.rejected'
  | 'sharepoint_site.approved'
  | 'sharepoint_site.revoked'
  | 'scan.triggered'
  | 'scan_schedule.created'
  | 'scan_schedule.updated'
  | 'microsoft_tenant.connected'
  // ADR-0023 §3.9: written only when consentAssertedPermissionVersion
  // actually advances (an admin completed a real re-consent redirect) —
  // never for a routine background read-verification refresh, and never
  // for a tenant already at the current required version.
  | 'microsoft_tenant.permission_consent_asserted'
  // ADR-0022 §3.6: one row per bulk-remediation initiation (aggregate,
  // matching this type's existing convention of one row per privileged
  // action, never per affected entity — e.g. site approval). Written by
  // the API layer at job-creation time (Phase 6, not this phase).
  | 'remediation_job.initiated';

export type AuditLogTargetType = 'User' | 'SharePointSite' | 'ScanJob' | 'ScanSchedule' | 'MicrosoftTenant' | 'RemediationJob';

export interface AuditLogResponse {
  id: string;
  actorUserId: string | null;
  actorUserName: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogListQuery {
  page?: number;
  pageSize?: number;
  action?: string;
  targetType?: string;
  sortDir?: SortDirection;
  since?: string;
  until?: string;
}
