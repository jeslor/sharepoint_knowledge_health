import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SCAN_QUEUE } from '@sph/types';
import { AuthModule } from '../auth/auth.module';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { ScansController } from './scans.controller';
import { ScansService } from './scans.service';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({
      name: SCAN_QUEUE,
      // Whole-job retry is safe: document upsert is idempotent by
      // (siteId, graphItemId) and scoring is a full recompute each run, so
      // re-running process() from scratch after a transient failure (Redis
      // blip, DB connection drop, unhandled exception) never double-writes.
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
      },
    }),
  ],
  controllers: [ScansController],
  providers: [ScansService, OrganizationAccessGuard],
})
export class ScansModule {}
