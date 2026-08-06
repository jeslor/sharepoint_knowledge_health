import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { OrganizationAccessGuard } from '../common/organization-access.guard';

// A pure leaf module, matching AuditLogModule's exact shape — no imports of
// its own, so any consuming module can depend on it with zero circular-
// module risk.
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, OrganizationAccessGuard],
})
export class NotificationsModule {}
