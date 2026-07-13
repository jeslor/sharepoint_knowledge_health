import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { ScanScheduleController } from './scan-schedule.controller';
import { ScanScheduleService } from './scan-schedule.service';

@Module({
  imports: [AuthModule],
  controllers: [ScanScheduleController],
  providers: [ScanScheduleService, OrganizationAccessGuard],
})
export class ScanScheduleModule {}
