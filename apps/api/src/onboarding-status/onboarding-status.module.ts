import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OnboardingStatusController } from './onboarding-status.controller';
import { OnboardingStatusService } from './onboarding-status.service';
import { OrganizationAccessGuard } from '../common/organization-access.guard';

@Module({
  imports: [AuthModule],
  controllers: [OnboardingStatusController],
  providers: [OnboardingStatusService, OrganizationAccessGuard],
})
export class OnboardingStatusModule {}
