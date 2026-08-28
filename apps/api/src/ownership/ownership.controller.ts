import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { OwnershipCoverageResponse } from '@sph/types';
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { OwnershipCoverageService } from './ownership.service';

// ADR-0024 §3.5: read-tier, no RolesGuard/@Roles — same "any authenticated
// org member may read this" convention as GovernanceAnalytics/AuditLog/the
// P0-3 remediation GET routes. Only mutations carry a Roles guard anywhere
// in this API, and this feature has no mutation.
@Controller('organizations/:id')
@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)
export class OwnershipController {
  constructor(private readonly ownershipCoverageService: OwnershipCoverageService) {}

  @Get('ownership-coverage')
  async getOwnershipCoverage(@Param('id') organizationId: string): Promise<OwnershipCoverageResponse> {
    return this.ownershipCoverageService.getCoverage(organizationId);
  }
}
