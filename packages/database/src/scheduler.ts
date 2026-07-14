import type { ScanSchedule } from '@prisma/client';
import { prisma } from './client';

/**
 * The second sanctioned unscoped query in this package (the first is
 * findUserByEntraIdentity in identity.ts, used before an organizationId
 * exists at all). This one is unscoped for a different reason: "find every
 * due schedule across every organization" is inherently cross-tenant — no
 * single organizationId can scope it, since the whole point is discovering
 * which organizations are due *before* anything org-specific happens.
 *
 * Only ScanSchedule rows are read here (id, organizationId, frequency,
 * timestamps) — no other tenant's data is touched. The caller is expected
 * to immediately switch to createTenantContext(schedule.organizationId)
 * for every subsequent operation once a due schedule is found (ADR-0015 §1,
 * Phase 7B's scheduler tick in apps/worker).
 *
 * Every other database access must go through createTenantContext().
 */
export async function findDueScanSchedules(now: Date): Promise<ScanSchedule[]> {
  return prisma.scanSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
  });
}
