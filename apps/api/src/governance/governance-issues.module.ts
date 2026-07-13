import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { GovernanceActivityModule } from './governance-activity.module';
import { GovernanceAnalyticsService } from './governance-analytics.service';
import { GovernanceIssuesController } from './governance-issues.controller';
import { GovernanceIssuesService } from './governance-issues.service';

@Module({
  imports: [AuthModule, GovernanceActivityModule],
  controllers: [GovernanceIssuesController],
  providers: [GovernanceIssuesService, GovernanceAnalyticsService, OrganizationAccessGuard],
})
export class GovernanceIssuesModule {}
