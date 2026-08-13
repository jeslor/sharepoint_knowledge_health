import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { User } from '@sph/database';
import type {
  ConfirmReviewDateMappingRequest,
  ReviewDateEligibilityResponse,
  ReviewDateLibraryResponse,
  ReviewDateMappingResponse,
} from '@sph/types';
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { SharePointMetadataService } from './sharepoint-metadata.service';

@Controller('organizations/:id')
@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)
export class SharePointMetadataController {
  constructor(private readonly sharePointMetadataService: SharePointMetadataService) {}

  // Same mutation-permission tier as review-date/owner writes elsewhere
  // (ADR-0016 §4.6/§7): Admin or GovernanceManager, never Member.
  @Post('sharepoint-sites/:siteId/review-date-mapping/confirm')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'GovernanceManager')
  async confirmReviewDateMapping(
    @Param('id') organizationId: string,
    @Param('siteId') siteId: string,
    @CurrentUser() user: User,
    @Body() body: ConfirmReviewDateMappingRequest,
  ): Promise<ReviewDateMappingResponse> {
    if (!body?.graphListId) {
      throw new BadRequestException('graphListId is required');
    }
    return this.sharePointMetadataService.confirmReviewDateMapping(
      organizationId,
      siteId,
      body.graphListId,
      user.id,
      body.columnDefinitionId,
    );
  }

  // Phase 1.1: read-only, no @Roles() restriction — inspecting eligibility
  // mutates nothing, unlike confirm above, so any authenticated org member
  // can check it. Lets a caller (eventually a Phase 2 admin UI) learn a
  // library's state without attempting a confirm and handling its
  // exceptions.
  @Get('sharepoint-sites/:siteId/review-date-mapping/eligibility')
  async checkReviewDateEligibility(
    @Param('id') organizationId: string,
    @Param('siteId') siteId: string,
    @Query('graphListId') graphListId: string,
  ): Promise<ReviewDateEligibilityResponse> {
    if (!graphListId) {
      throw new BadRequestException('graphListId is required');
    }
    return this.sharePointMetadataService.checkReviewDateEligibility(organizationId, siteId, graphListId);
  }

  // Phase 2: read-only, no @Roles() restriction — same rationale as
  // eligibility above. The one prerequisite the Review Date settings UI
  // needs that nothing else exposes: which document libraries exist for
  // this site at all.
  @Get('sharepoint-sites/:siteId/review-date-libraries')
  async listReviewDateLibraries(
    @Param('id') organizationId: string,
    @Param('siteId') siteId: string,
  ): Promise<ReviewDateLibraryResponse[]> {
    return this.sharePointMetadataService.listReviewDateLibraries(organizationId, siteId);
  }
}
