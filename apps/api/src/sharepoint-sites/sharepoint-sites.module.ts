import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SharePointSitesController } from './sharepoint-sites.controller';
import { SharePointSitesService } from './sharepoint-sites.service';
import { OrganizationAccessGuard } from '../common/organization-access.guard';

@Module({
  // DiscoveryModule, not SharePointSitesModule <-> AuthModule directly —
  // DiscoveryModule depends on neither, avoiding a cycle (see
  // DiscoveryProducerService's doc comment). AuditLogModule is a pure leaf
  // (no imports of its own), so importing it here carries the same
  // zero-cycle-risk guarantee.
  imports: [AuthModule, DiscoveryModule, AuditLogModule],
  controllers: [SharePointSitesController],
  providers: [SharePointSitesService, OrganizationAccessGuard],
})
export class SharePointSitesModule {}
