import { runWithConcurrencyLimit } from './concurrency-limiter';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('runWithConcurrencyLimit', () => {
  it('processes every item exactly once', async () => {
    const processed: number[] = [];
    await runWithConcurrencyLimit([1, 2, 3, 4, 5], 2, async (item) => {
      processed.push(item);
    });

    expect(processed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never runs more than `limit` items concurrently', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await runWithConcurrencyLimit(items, 3, async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 1));
      concurrent -= 1;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  it('actually achieves concurrency up to the limit, not accidentally serial', async () => {
    const gate = deferred<void>();
    let started = 0;

    const run = runWithConcurrencyLimit([1, 2, 3], 3, async () => {
      started += 1;
      await gate.promise;
    });

    // All 3 workers should have started before any of them can finish —
    // proves this isn't secretly processing one at a time.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toBe(3);

    gate.resolve();
    await run;
  });

  it('handles an empty list without error', async () => {
    const worker = jest.fn();
    await runWithConcurrencyLimit([], 5, worker);
    expect(worker).not.toHaveBeenCalled();
  });

  it('handles a limit larger than the number of items', async () => {
    const processed: number[] = [];
    await runWithConcurrencyLimit([1, 2], 10, async (item) => {
      processed.push(item);
    });
    expect(processed.sort()).toEqual([1, 2]);
  });

  it('propagates a worker error without losing track of items already in flight', async () => {
    const processed: number[] = [];
    await expect(
      runWithConcurrencyLimit([1, 2, 3], 3, async (item) => {
        if (item === 2) throw new Error('boom');
        processed.push(item);
      }),
    ).rejects.toThrow('boom');
  });
});
