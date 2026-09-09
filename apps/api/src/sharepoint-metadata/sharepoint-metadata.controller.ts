import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { User } from '@sph/database';
import type {
  ConfirmReviewDateMappingRequest,
  ReviewDateEligibilityResponse,
  ReviewDateLibraryResponse,
  ReviewDateMappingResponse,
  ClassificationCandidateColumn,
  ClassificationFieldResponse,
  ClassificationLibraryResponse,
  DesignateClassificationFieldRequest,
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

  // ADR-0025: Taxonomy classification-field configuration. Read endpoints are
  // unrestricted (inspection); mutations are Admin/GovernanceManager, the
  // same tier as review-date confirm and owner writes.

  @Get('sharepoint-sites/:siteId/classification-libraries')
  async listClassificationLibraries(
    @Param('id') organizationId: string,
    @Param('siteId') siteId: string,
  ): Promise<ClassificationLibraryResponse[]> {
    return this.sharePointMetadataService.listClassificationLibraries(organizationId, siteId);
  }

  @Get('sharepoint-sites/:siteId/classification-candidates')
  async listClassificationCandidates(
    @Param('id') organizationId: string,
    @Param('siteId') siteId: string,
    @Query('graphListId') graphListId: string,
  ): Promise<ClassificationCandidateColumn[]> {
    if (!graphListId) {
      throw new BadRequestException('graphListId is required');
    }
    return this.sharePointMetadataService.listClassificationCandidates(organizationId, siteId, graphListId);
  }

  @Post('sharepoint-sites/:siteId/classification-fields')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'GovernanceManager')
  async designateClassificationField(
    @Param('id') organizationId: string,
    @Param('siteId') siteId: string,
    @CurrentUser() user: User,
    @Body() body: DesignateClassificationFieldRequest,
  ): Promise<ClassificationFieldResponse> {
    if (!body?.graphListId || !body?.columnDefinitionId) {
      throw new BadRequestException('graphListId and columnDefinitionId are required');
    }
    return this.sharePointMetadataService.designateClassificationField(
      organizationId,
      siteId,
      body.graphListId,
      body.columnDefinitionId,
      user.id,
    );
  }

  @Delete('sharepoint-sites/:siteId/classification-fields/:fieldId')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'GovernanceManager')
  @HttpCode(204)
  async removeClassificationField(
    @Param('id') organizationId: string,
    @Param('siteId') siteId: string,
    @Param('fieldId') fieldId: string,
  ): Promise<void> {
    await this.sharePointMetadataService.removeClassificationField(organizationId, siteId, fieldId);
  }
}
