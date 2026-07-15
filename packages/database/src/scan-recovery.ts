import { prisma } from './client';

/**
 * Phase 9.5: closes a reliability gap found during Local Acceptance Testing
 * (docs/testing/local-acceptance-testing.md §1.4/5.19.1) — DocumentCollectorProcessor
 * sets ScanJob.status to 'Running' at the top of process() and only ever
 * transitions it to 'Completed'/'Failed' at the end of a *successful* run.
 * If the worker process dies mid-scan, BullMQ's own stalled-job detection
 * eventually gives up on the underlying job execution, but nothing was
 * updating the ScanJob row itself — it stayed 'Running' forever, which
 * permanently blocked every future scan (manual or scheduled) for that
 * Microsoft tenant, since both trigger paths check for an in-flight
 * Queued/Running job before allowing a new one.
 *
 * The third sanctioned unscoped query in this package (after
 * findUserByEntraIdentity in identity.ts and findDueScanSchedules in
 * scheduler.ts) — for the same class of reason as the second: "every
 * ScanJob stuck Running past a safe threshold, across every organization"
 * is inherently cross-tenant, since discovering which ones are stale is
 * exactly what has to happen *before* anything tenant-scoped can run. Only
 * ScanJob rows already stuck past the threshold are touched.
 *
 * Every other database access must go through createTenantContext().
 */
export async function recoverStaleScanJobs(now: Date, staleAfterMs: number): Promise<number> {
  const cutoff = new Date(now.getTime() - staleAfterMs);
  const result = await prisma.scanJob.updateMany({
    where: { status: 'Running', startedAt: { lt: cutoff } },
    data: {
      status: 'Failed',
      completedAt: now,
      errorSummary: 'Recovered automatically: scan job exceeded the maximum expected running time (likely an unclean worker shutdown).',
    },
  });
  return result.count;
}
