import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SCAN_QUEUE } from '@sph/types';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [
    // Phase 9: registered independently of ScansModule/QueueModule's own
    // registration purely to get a DI-injectable Queue handle for its
    // `.client` (the underlying ioredis connection) — used only for a
    // readiness ping, never to add jobs. A second Queue client instance
    // for the same queue name is safe (BullMQ's Queue is a thin client
    // wrapper around Redis keys, not a singleton registry); this never
    // touches defaultJobOptions or job data.
    BullModule.registerQueue({ name: SCAN_QUEUE }),
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
