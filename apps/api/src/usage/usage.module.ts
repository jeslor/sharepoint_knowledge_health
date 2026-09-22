import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

@Module({
  imports: [AuthModule],
  controllers: [UsageController],
  providers: [UsageService, OrganizationAccessGuard],
})
export class UsageModule {}
