import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { User } from '@sph/database';
import type {
  CreateRemediationJobRequest,
  CreateRemediationJobResponse,
  PaginatedResponse,
  RemediationJobDetailResponse,
  RemediationJobListQuery,
  RemediationJobSummary,
} from '@sph/types';
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { RemediationService } from './remediation.service';

@Controller('organizations/:id')
@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)
export class RemediationController {
  constructor(private readonly remediationService: RemediationService) {}

  // ADR-0022 §8: same mutation-permission tier as the human-facing
  // equivalent (documents.controller.ts's setReviewDate) — Admin or
  // GovernanceManager, never Member.
  @Post('remediation-jobs')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'GovernanceManager')
  async createRemediationJob(
    @Param('id') organizationId: string,
    @CurrentUser() user: User,
    @Body() body: CreateRemediationJobRequest,
  ): Promise<CreateRemediationJobResponse> {
    return this.remediationService.createRemediationJob(organizationId, user.id, user.role, body);
  }

  // P0-3: read-tier, no RolesGuard/@Roles — same "any authenticated org
  // member may read this" convention as AuditLogController/ScansController's
  // own GET routes (only mutations carry a Roles guard anywhere in this API).
  @Get('remediation-jobs')
  async listRemediationJobs(
    @Param('id') organizationId: string,
    @Query() query: Record<string, string>,
  ): Promise<PaginatedResponse<RemediationJobSummary>> {
    return this.remediationService.listRemediationJobs(organizationId, this.parseListQuery(query));
  }

  @Get('remediation-jobs/:jobId')
  async getRemediationJob(
    @Param('id') organizationId: string,
    @Param('jobId') jobId: string,
  ): Promise<RemediationJobDetailResponse> {
    return this.remediationService.getRemediationJob(organizationId, jobId);
  }

  // Same page/pageSize validation as AuditLogController.parseQuery.
  private parseListQuery(query: Record<string, string>): RemediationJobListQuery {
    const page = query.page ? Number(query.page) : undefined;
    const pageSize = query.pageSize ? Number(query.pageSize) : undefined;

    if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
      throw new BadRequestException('page must be a positive integer');
    }
    if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)) {
      throw new BadRequestException('pageSize must be an integer between 1 and 100');
    }

    return { page, pageSize };
  }
}
