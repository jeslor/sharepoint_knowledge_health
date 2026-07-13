import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { GovernanceActivityModule } from './governance-activity.module';
import { GovernanceIssuesController } from './governance-issues.controller';
import { GovernanceIssuesService } from './governance-issues.service';

@Module({
  imports: [AuthModule, GovernanceActivityModule],
  controllers: [GovernanceIssuesController],
  providers: [GovernanceIssuesService, OrganizationAccessGuard],
})
export class GovernanceIssuesModule {}
