import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { UsageResponse } from '@sph/types';
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { UsageService } from './usage.service';

// Phase 4: read-tier, no RolesGuard/@Roles — same "any authenticated org
// member may read this" convention as HealthSummary/Ownership/AuditLog
// (only mutations carry a Roles guard anywhere in this API, and this
// feature has no mutation).
@Controller('organizations/:id')
@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get('usage')
  async getUsage(@Param('id') organizationId: string): Promise<UsageResponse> {
    return this.usageService.getUsage(organizationId);
  }
}
