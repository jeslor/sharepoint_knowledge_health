import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { GovernanceIssuesController } from './governance-issues.controller';
import { GovernanceIssuesService } from './governance-issues.service';

@Module({
  imports: [AuthModule],
  controllers: [GovernanceIssuesController],
  providers: [GovernanceIssuesService, OrganizationAccessGuard],
})
export class GovernanceIssuesModule {}
