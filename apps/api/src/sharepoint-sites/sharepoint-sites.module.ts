import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { SharePointSitesController } from './sharepoint-sites.controller';
import { SharePointSitesService } from './sharepoint-sites.service';
import { OrganizationAccessGuard } from '../common/organization-access.guard';

@Module({
  // DiscoveryModule, not SharePointSitesModule <-> AuthModule directly —
  // DiscoveryModule depends on neither, avoiding a cycle (see
  // DiscoveryProducerService's doc comment).
  imports: [AuthModule, DiscoveryModule],
  controllers: [SharePointSitesController],
  providers: [SharePointSitesService, OrganizationAccessGuard],
})
export class SharePointSitesModule {}
