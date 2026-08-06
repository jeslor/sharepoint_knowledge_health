import { prisma } from './client';

/**
 * The third sanctioned unscoped query in this package (the first is
 * findUserByEntraIdentity in identity.ts, used before an organizationId
 * exists at all; the second is findDueScanSchedules in scheduler.ts, for
 * the identical reason this one is unscoped). "Which organizations have at
 * least one Open/InProgress GovernanceIssue right now" is inherently
 * cross-tenant — no single organizationId can scope it, since the whole
 * point is discovering which organizations need a reconciliation check
 * *before* anything org-specific happens.
 *
 * Only distinct organizationId values are read here — no GovernanceIssue
 * row content, no other tenant's data. The caller (ADR-0021 §3.3's
 * periodic safety-net sweep, apps/worker) is expected to immediately
 * switch to createTenantContext(organizationId) — via
 * NotificationReconciliationService, the same single execution path the
 * event-driven trigger also uses — for every subsequent operation once an
 * affected organization is found.
 *
 * Every other database access must go through createTenantContext().
 */
export async function findOrganizationIdsWithOpenGovernanceIssues(): Promise<string[]> {
  const rows = await prisma.governanceIssue.findMany({
    where: { status: { in: ['Open', 'InProgress'] } },
    select: { organizationId: true },
    distinct: ['organizationId'],
  });
  return rows.map((row) => row.organizationId);
}
