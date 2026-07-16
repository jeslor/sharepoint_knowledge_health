import { bullConnectionOptions } from './app.module';

describe('bullConnectionOptions (Phase 7, LAT F2)', () => {
  const originalRedisUrl = process.env.REDIS_URL;

  afterEach(() => {
    process.env.REDIS_URL = originalRedisUrl;
  });

  it('bounds retries and connect timeout tightly instead of relying on ioredis defaults', () => {
    const options = bullConnectionOptions();

    // Prior bare config ran on ioredis defaults (maxRetriesPerRequest: 20,
    // connectTimeout: 10000ms) — the exact cause of LAT F2's hang. This
    // connection is producer-only (apps/api never runs a BullMQ Worker),
    // so it's safe to bound tightly, unlike apps/worker's connection.
    expect(options.maxRetriesPerRequest).toBe(1);
    expect(options.connectTimeout).toBe(5000);
  });

  it('reads the connection URL from REDIS_URL', () => {
    process.env.REDIS_URL = 'redis://test-host:6379';
    expect(bullConnectionOptions().url).toBe('redis://test-host:6379');
  });

  // Phase 7 correction #2: a prior version of this config added an explicit
  // retryStrategy that gave up permanently after 2 retries. That fixed the
  // health-check hang but broke reconnection — confirmed live, Redis coming
  // back online didn't recover the connection without restarting apps/api.
  // Reverted. retryStrategy is deliberately left unset here (ioredis's own
  // default keeps retrying indefinitely with capped backoff), so the
  // connection self-heals on its own — the health-check hang is fixed at
  // its actual source instead (health.service.ts's own explicit timeout).
  it('does not override retryStrategy, so the connection keeps self-healing in the background', () => {
    const options = bullConnectionOptions();
    expect(options).not.toHaveProperty('retryStrategy');
  });
});
