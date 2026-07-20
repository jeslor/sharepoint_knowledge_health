import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { OnboardingStatusResponse } from '@sph/types';
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { OnboardingStatusService } from './onboarding-status.service';

@Controller('organizations/:id')
@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)
export class OnboardingStatusController {
  constructor(private readonly onboardingStatusService: OnboardingStatusService) {}

  // No @Roles('Admin') — any authenticated org member may read connection
  // health, matching how site/scan status are already readable by non-Admins.
  @Get('onboarding-status')
  async getStatus(@Param('id') organizationId: string): Promise<OnboardingStatusResponse> {
    return this.onboardingStatusService.getStatus(organizationId);
  }
}
