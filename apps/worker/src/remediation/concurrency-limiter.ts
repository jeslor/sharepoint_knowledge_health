/**
 * ADR-0022 §3.3: bounded in-job concurrency is a new design surface this
 * codebase has no existing primitive for (SCAN_QUEUE/DISCOVERY_QUEUE/
 * NOTIFICATION_RECONCILIATION_QUEUE's own `concurrency` settings are all
 * job-level — how many *jobs* run in parallel — never sub-item-level). No
 * existing dependency (p-limit or similar) is present anywhere in this
 * monorepo, and pulling one in for a ~10-line worker-pool would violate
 * this project's own "avoid unnecessary dependencies" principle — so this
 * is a small, local, independently-testable implementation instead.
 *
 * A fixed-size pool of `limit` concurrent "runners," each pulling the next
 * item off a shared queue until it's empty — never more than `limit`
 * items in flight at once, and never a bare `Promise.all()` over the
 * entire list (ADR-0022 explicitly rules that out for up to 500 items).
 */
export async function runWithConcurrencyLimit<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const poolSize = Math.max(1, Math.min(limit, items.length));

  const runners = Array.from({ length: poolSize }, async () => {
    while (queue.length > 0) {
      const item = queue.shift() as T;
      await worker(item);
    }
  });

  await Promise.all(runners);
}
