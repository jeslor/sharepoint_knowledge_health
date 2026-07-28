import { Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { MicrosoftTenant, SharePointSite, User } from '@sph/database';
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

  // ADR-0014 amendment: enqueues onto DISCOVERY_QUEUE — apps/worker's
  // SiteDiscoveryProcessor owns execution. Returns the MicrosoftTenant row
  // reflecting the new discoveryStatus (Queued, or unchanged if a
  // discovery operation was already Queued/Running — a safe no-op, not an
  // error), not the resulting sites, which don't exist yet at request time.
  @Post('microsoft-tenants/:tenantId/discover-sites')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  async discoverSites(@Param('id') organizationId: string, @Param('tenantId') tenantId: string): Promise<MicrosoftTenant> {
    return this.sharePointSitesService.enqueueDiscovery(organizationId, tenantId);
  }

  // Phase 9.5: the dashboard Sites page never knows a microsoftTenantId —
  // same auto-resolve convenience already established by POST
  // organizations/:id/scans (ScansService.triggerScanForOrganization).
  @Post('discover-sites')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  async discoverSitesForOrganization(@Param('id') organizationId: string): Promise<MicrosoftTenant> {
    return this.sharePointSitesService.enqueueDiscoveryForOrganization(organizationId);
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
  async revokeSite(
    @Param('id') organizationId: string,
    @Param('siteId') siteId: string,
    @CurrentUser() user: User,
  ): Promise<SharePointSite> {
    return this.sharePointSitesService.revokeSite(organizationId, siteId, user.id);
  }
}
