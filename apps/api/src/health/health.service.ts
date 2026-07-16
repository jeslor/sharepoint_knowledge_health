import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { checkDatabaseConnection } from '@sph/database';
import { SCAN_QUEUE, type ScanJobPayload } from '@sph/types';
import type { HealthStatus, ReadinessStatus } from '@sph/types';
import { withTimeout } from '../common/with-timeout';

const REDIS_READINESS_TIMEOUT_MS = 3000;

@Injectable()
export class HealthService {
  constructor(@InjectQueue(SCAN_QUEUE) private readonly scanQueue: Queue<ScanJobPayload>) {}

  getStatus(): HealthStatus {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  // Phase 9: readiness, not liveness — checks the dependencies this
  // instance actually needs to serve a real request. Never throws; a
  // failed check degrades the response instead of crashing the endpoint
  // meant to report it.
  async getReadiness(): Promise<ReadinessStatus> {
    const [databaseOk, redisOk] = await Promise.all([checkDatabaseConnection(), this.checkRedisConnection()]);

    const checks = {
      database: databaseOk ? ('ok' as const) : ('error' as const),
      redis: redisOk ? ('ok' as const) : ('error' as const),
    };

    return {
      status: databaseOk && redisOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private async checkRedisConnection(): Promise<boolean> {
    try {
      // BullMQ's IRedisClient (an abstraction over ioredis/node-redis/Bun)
      // doesn't declare `ping()` — `info()` is an equally real round-trip
      // command that's part of the declared interface, so this works
      // regardless of which underlying Redis client backend is configured.
      //
      // Phase 7 (LAT F2) correction: `this.scanQueue.client` resolves via
      // BullMQ's waitUntilReady(), which waits for ioredis's 'ready'/'end'
      // event — it never sends a command, so it is NOT bounded by the
      // connection's maxRetriesPerRequest (confirmed by reading BullMQ's
      // redis-connection.js directly). An earlier fix attempted to bound
      // this by making retryStrategy give up permanently, but that broke
      // reconnection once Redis came back (confirmed live: /health/ready
      // kept reporting 'error' with Redis genuinely healthy again, only
      // fixed by restarting apps/api). This explicit timeout bounds just
      // this readiness check instead, leaving the connection's own
      // retryStrategy at ioredis's default so it keeps self-healing.
      const redis = await withTimeout(this.scanQueue.client, REDIS_READINESS_TIMEOUT_MS, 'Redis readiness check timed out');
      await redis.info();
      return true;
    } catch {
      return false;
    }
  }
}
