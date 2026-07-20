import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DISCOVERY_QUEUE } from '@sph/types';
import { SiteDiscoveryProcessor } from './site-discovery.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: DISCOVERY_QUEUE,
      // ADR-0014 amendment: whole-job retry is safe (discoverSites is
      // idempotent — see the processor). Matches SCAN_QUEUE's own
      // defaultJobOptions shape exactly (queue.module.ts) — same retry
      // policy for the same reason, applied to discovery instead of
      // scanning.
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    }),
  ],
  providers: [SiteDiscoveryProcessor],
})
export class DiscoveryModule {}
