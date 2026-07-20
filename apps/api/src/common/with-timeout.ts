/**
 * Bounds a promise to a deterministic maximum wait, independent of whatever
 * the promise itself is doing internally. First proven for
 * health.service.ts's Redis readiness check (BullMQ's waitUntilReady() is
 * not bounded by ioredis's maxRetriesPerRequest — confirmed by reading
 * BullMQ's source), then reused for scans.service.ts's queue.add() (ioredis's
 * maxRetriesPerRequest turned out to be a periodic, connection-wide queue
 * flush tied to a shared retry counter, not a per-command bound — confirmed
 * by reading ioredis's source — so it cannot provide a predictable timeout
 * on its own). Promise.race internally subscribes to both branches, so the
 * losing promise's eventual settlement is never an unhandled rejection.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage = 'Operation timed out'): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}
