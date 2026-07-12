import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { HealthSummaryController } from './health-summary.controller';
import { HealthSummaryService } from './health-summary.service';

@Module({
  imports: [AuthModule],
  controllers: [HealthSummaryController],
  providers: [HealthSummaryService, OrganizationAccessGuard],
})
export class HealthSummaryModule {}
