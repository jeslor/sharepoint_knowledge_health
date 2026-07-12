import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { HealthSummaryResponse } from '@sph/types';
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { HealthSummaryService } from './health-summary.service';

@Controller('organizations/:id')
@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)
export class HealthSummaryController {
  constructor(private readonly healthSummaryService: HealthSummaryService) {}

  @Get('health-summary')
  async getSummary(@Param('id') organizationId: string): Promise<HealthSummaryResponse> {
    return this.healthSummaryService.getSummary(organizationId);
  }
}
