import { Module } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { OrganizationAccessGuard } from '../common/organization-access.guard';

// A pure leaf module — no imports of its own, matching
// GovernanceActivityModule's exact shape. EntraJwtGuard/TenantContextGuard
// have no constructor dependencies (confirmed: UsersModule already uses
// them the same way, with no AuthModule import), so this module doesn't
// need to import AuthModule just to reference the guard classes on its own
// controller. Being import-free is what lets every consuming module
// (UsersModule, SharePointSitesModule, ScansModule, ScanScheduleModule,
// AuthModule) import AuditLogModule with zero risk of the circular-module
// problem AuthModule/SharePointSitesModule already had to route around
// once via DiscoveryModule.
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService, OrganizationAccessGuard],
  exports: [AuditLogService],
})
export class AuditLogModule {}
