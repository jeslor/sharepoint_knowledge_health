import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { checkDatabaseConnection } from '@sph/database';
import { SCAN_QUEUE, type ScanJobPayload } from '@sph/types';
import type { HealthStatus, ReadinessStatus } from '@sph/types';

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
      const redis = await this.scanQueue.client;
      await redis.info();
      return true;
    } catch {
      return false;
    }
  }
}
