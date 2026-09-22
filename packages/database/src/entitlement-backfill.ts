import { prisma } from './client';

export const DEFAULT_TRIAL_DOCUMENT_LIMIT = 2000;

export interface EntitlementBackfillResult {
  organizationId: string;
  organizationName: string;
  documentLimit: number;
  currentDocumentCount: number;
}

/**
 * One-time migration step: creates a Trial entitlement for every
 * Organization that predates the OrganizationEntitlement model. The
 * fourth sanctioned unscoped query in this package (after
 * findUserByEntraIdentity, findDueScanSchedules, and
 * recoverStaleScanJobs/findMicrosoftTenantByEntraTenantId) — for the same
 * class of reason as those: "every Organization missing an entitlement,
 * across every tenant" is inherently cross-tenant, since finding them is
 * exactly what has to happen before anything tenant-scoped can run. Every
 * other database access in this package goes through createTenantContext().
 *
 * Deliberately defaults every backfilled organization to Trial/2000,
 * never a silently-invented "grandfathered/unlimited" plan — see the
 * accompanying report for why this default is safe against the actual
 * data in this environment (no existing organization is anywhere near
 * 2000 documents today) and for the one open question (a long-lived
 * demo/showcase organization) this script deliberately does not try to
 * resolve on its own.
 *
 * currentDocumentCount is seeded from each organization's REAL, current
 * count of Active documents — never 0 — so an organization that already
 * has documents indexed before this feature ships doesn't silently
 * under-count its own usage from the moment this ships. Contrast with
 * onboarding.ts's provisionOrganizationFromConsent, where 0 is correct
 * because that organization is, by construction, brand new.
 *
 * Idempotent: only ever targets organizations with no entitlement row yet
 * (`entitlement: null`), matching demo-seed's own "safe to run repeatedly"
 * discipline — re-running after some organizations are already backfilled
 * only processes the remainder.
 */
export async function backfillOrganizationEntitlements(): Promise<EntitlementBackfillResult[]> {
  const organizationsWithoutEntitlement = await prisma.organization.findMany({
    where: { entitlement: null },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  const results: EntitlementBackfillResult[] = [];
  for (const organization of organizationsWithoutEntitlement) {
    const currentDocumentCount = await prisma.document.count({
      where: { organizationId: organization.id, status: 'Active' },
    });

    await prisma.organizationEntitlement.create({
      data: {
        organizationId: organization.id,
        planType: 'Trial',
        documentLimit: DEFAULT_TRIAL_DOCUMENT_LIMIT,
        currentDocumentCount,
      },
    });

    results.push({
      organizationId: organization.id,
      organizationName: organization.name,
      documentLimit: DEFAULT_TRIAL_DOCUMENT_LIMIT,
      currentDocumentCount,
    });
  }

  return results;
}
