import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { EmailModule } from '../email/email.module';
import { UpgradeRequestController } from './upgrade-request.controller';
import { UpgradeRequestService } from './upgrade-request.service';

@Module({
  imports: [AuthModule, EmailModule],
  controllers: [UpgradeRequestController],
  providers: [UpgradeRequestService, OrganizationAccessGuard],
})
export class UpgradeRequestModule {}
