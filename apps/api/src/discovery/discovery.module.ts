import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DISCOVERY_QUEUE } from '@sph/types';
import { DiscoveryProducerService } from './discovery-producer.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: DISCOVERY_QUEUE,
      // Matches SCAN_QUEUE's registration exactly (scans.module.ts) — whole-
      // job retry is safe (apps/worker's SiteDiscoveryProcessor is
      // idempotent, ADR-0014 amendment), and completed/failed jobs must not
      // accumulate in Redis unboundedly (Phase 9's fix, applied here from
      // day one rather than rediscovered later).
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    }),
  ],
  providers: [DiscoveryProducerService],
  exports: [DiscoveryProducerService],
})
export class DiscoveryModule {}
