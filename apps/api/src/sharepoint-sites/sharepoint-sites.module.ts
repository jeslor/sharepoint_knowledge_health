import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SharePointSitesController } from './sharepoint-sites.controller';
import { SharePointSitesService } from './sharepoint-sites.service';
import { OrganizationAccessGuard } from '../common/organization-access.guard';

@Module({
  imports: [AuthModule],
  controllers: [SharePointSitesController],
  providers: [SharePointSitesService, OrganizationAccessGuard],
})
export class SharePointSitesModule {}
