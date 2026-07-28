import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ScanScheduleController } from './scan-schedule.controller';
import { ScanScheduleService } from './scan-schedule.service';

@Module({
  imports: [AuthModule, AuditLogModule],
  controllers: [ScanScheduleController],
  providers: [ScanScheduleService, OrganizationAccessGuard],
})
export class ScanScheduleModule {}
