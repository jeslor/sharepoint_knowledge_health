import { Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { SharePointSite, User } from '@sph/database';
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { SharePointSitesService } from './sharepoint-sites.service';

@Controller('organizations/:id')
@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)
export class SharePointSitesController {
  constructor(private readonly sharePointSitesService: SharePointSitesService) {}

  @Post('microsoft-tenants/:tenantId/discover-sites')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  async discoverSites(@Param('id') organizationId: string, @Param('tenantId') tenantId: string): Promise<SharePointSite[]> {
    return this.sharePointSitesService.discoverSites(organizationId, tenantId);
  }

  @Get('sharepoint-sites')
  async listSites(@Param('id') organizationId: string): Promise<SharePointSite[]> {
    return this.sharePointSitesService.listSites(organizationId);
  }

  @Patch('sharepoint-sites/:siteId/approve')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  async approveSite(
    @Param('id') organizationId: string,
    @Param('siteId') siteId: string,
    @CurrentUser() user: User,
  ): Promise<SharePointSite> {
    return this.sharePointSitesService.approveSite(organizationId, siteId, user.id);
  }

  @Patch('sharepoint-sites/:siteId/revoke')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  async revokeSite(@Param('id') organizationId: string, @Param('siteId') siteId: string): Promise<SharePointSite> {
    return this.sharePointSitesService.revokeSite(organizationId, siteId);
  }
}
