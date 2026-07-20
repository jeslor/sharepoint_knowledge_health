import { prisma } from './client';

/**
 * Mirrors recoverStaleScanJobs (scan-recovery.ts) exactly, for the same
 * class of problem: SiteDiscoveryProcessor sets discoveryStatus to
 * 'Running' at the top of process() and only ever transitions it to
 * 'Completed'/'Failed' at the end of a run. If the worker process dies
 * mid-discovery, nothing updates the MicrosoftTenant row itself — it stays
 * 'Running' forever, permanently blocking every future discovery attempt
 * (DiscoveryProducerService's guard treats Running as already-in-flight).
 *
 * Deliberately the same narrow scope as recoverStaleScanJobs: this recovers
 * stuck 'Running' only, not stuck 'Queued'. A tenant orphaned at 'Queued'
 * (DiscoveryProducerService's own compensating write *and* the enqueue
 * itself both failing in the same instant) is the same narrow, accepted
 * residual risk the existing ScanJob pipeline already tolerates — not a
 * new gap introduced here, and not solved by this function either.
 *
 * The fourth sanctioned unscoped query in this package (after
 * findUserByEntraIdentity, findDueScanSchedules, and recoverStaleScanJobs)
 * — for the same reason as the others: "every MicrosoftTenant stuck
 * Running past a safe threshold, across every organization" is inherently
 * cross-tenant. Every other database access must go through
 * createTenantContext().
 */
export async function recoverStaleDiscoveries(now: Date, staleAfterMs: number): Promise<number> {
  const cutoff = new Date(now.getTime() - staleAfterMs);
  const result = await prisma.microsoftTenant.updateMany({
    where: { discoveryStatus: 'Running', discoveryStartedAt: { lt: cutoff } },
    data: {
      discoveryStatus: 'Failed',
      discoveryCompletedAt: now,
      discoveryError: 'Recovered automatically: discovery exceeded the maximum expected running time (likely an unclean worker shutdown).',
    },
  });
  return result.count;
}
