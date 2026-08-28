import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { REMEDIATION_QUEUE } from '@sph/types';
import { AuthModule } from '../auth/auth.module';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { RemediationController } from './remediation.controller';
import { RemediationService } from './remediation.service';

@Module({
  imports: [
    AuthModule,
    AuditLogModule,
    // Matches apps/worker/src/remediation/remediation.module.ts's own
    // registration exactly (ADR-0022 §3.3) — each BullMQ-registering Nest
    // application needs its own Queue client with matching
    // defaultJobOptions; same dual-registration precedent as SCAN_QUEUE
    // (apps/api/src/scans/scans.module.ts and apps/worker's scan queue
    // module).
    BullModule.registerQueue({
      name: REMEDIATION_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    }),
  ],
  controllers: [RemediationController],
  providers: [RemediationService, OrganizationAccessGuard],
})
export class RemediationModule {}
