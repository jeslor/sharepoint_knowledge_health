import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import type { User } from '@sph/database';
import type { RequestUpgradeRequest, RequestUpgradeResponse } from '@sph/types';
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { UpgradeRequestService } from './upgrade-request.service';

// Phase 6: deliberately no RolesGuard/@Roles — open to any authenticated
// org member (Admin, GovernanceManager, or Member), unlike most mutation
// routes in this API. Anyone who hits the trial limit in their daily work
// should be able to ask for more capacity, not just Admins; this creates
// one audit row and sends one internal email — it grants no access and
// changes no other organization state.
@Controller('organizations/:id')
@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)
export class UpgradeRequestController {
  constructor(private readonly upgradeRequestService: UpgradeRequestService) {}

  @Post('upgrade-request')
  async requestUpgrade(
    @Param('id') organizationId: string,
    @CurrentUser() user: User,
    @Body() body: RequestUpgradeRequest | undefined,
  ): Promise<RequestUpgradeResponse> {
    return this.upgradeRequestService.requestUpgrade(organizationId, user, body?.message);
  }
}
