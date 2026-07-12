import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { ScanJob, User } from '@sph/database';
import type { ScanResponse, TriggerScanRequest } from '@sph/types';
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { ScansService } from './scans.service';

@Controller('organizations/:id')
@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)
export class ScansController {
  constructor(private readonly scansService: ScansService) {}

  @Post('microsoft-tenants/:tenantId/scans')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  async triggerScan(
    @Param('id') organizationId: string,
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: User,
  ): Promise<ScanJob> {
    return this.scansService.triggerScan(organizationId, tenantId, user.id);
  }

  @Post('scans')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  async triggerScanForOrganization(
    @Param('id') organizationId: string,
    @CurrentUser() user: User,
    @Body() body: TriggerScanRequest | undefined,
  ): Promise<ScanJob> {
    return this.scansService.triggerScanForOrganization(organizationId, user.id, body?.microsoftTenantId);
  }

  @Get('scans')
  async listScans(@Param('id') organizationId: string): Promise<ScanResponse[]> {
    return this.scansService.listScans(organizationId);
  }

  @Get('scans/:scanId')
  async getScan(@Param('id') organizationId: string, @Param('scanId') scanId: string): Promise<ScanJob> {
    return this.scansService.getScan(organizationId, scanId);
  }
}
