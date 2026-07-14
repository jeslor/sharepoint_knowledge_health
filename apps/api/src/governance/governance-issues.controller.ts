import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { User } from '@sph/database';
import type {
  AssignableUserResponse,
  CreateGovernanceIssueRequest,
  GovernanceActivityListQuery,
  GovernanceActivityResponse,
  GovernanceActivityTypeValue,
  GovernanceAnalyticsQuery,
  GovernanceAnalyticsResponse,
  GovernanceIssueListQuery,
  GovernanceIssueResponse,
  GovernanceIssueStatusValue,
  GovernanceIssueTypeValue,
  GovernanceSummaryResponse,
  IssueSeverityFilter,
  PaginatedResponse,
  SortDirection,
  UpdateGovernanceIssueRequest,
} from '@sph/types';
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { GovernanceActivityService } from './governance-activity.service';
import { GovernanceAnalyticsService } from './governance-analytics.service';
import { GovernanceIssuesService } from './governance-issues.service';

const STATUS_VALUES: GovernanceIssueStatusValue[] = ['Open', 'InProgress', 'Resolved'];
const SEVERITY_VALUES: IssueSeverityFilter[] = ['NeedsAttention', 'RequiresReview'];
const ISSUE_TYPE_VALUES: GovernanceIssueTypeValue[] = [
  'Freshness',
  'Ownership',
  'ReviewStatus',
  'Metadata',
  'Duplication',
  'Age',
];
const SORT_BY_VALUES: Array<'createdAt' | 'updatedAt'> = ['createdAt', 'updatedAt'];
const SORT_DIR_VALUES: SortDirection[] = ['asc', 'desc'];
const ACTIVITY_TYPE_VALUES: GovernanceActivityTypeValue[] = [
  'IssueCreated',
  'IssueAssigned',
  'AssigneeChanged',
  'StatusChanged',
  'ResolutionNoteUpdated',
  'OwnerAssigned',
  'OwnerRemoved',
  'IssueReopened',
  'IssueResolved',
];

@Controller('organizations/:id/governance')
@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)
export class GovernanceIssuesController {
  constructor(
    private readonly governanceIssuesService: GovernanceIssuesService,
    private readonly governanceActivityService: GovernanceActivityService,
    private readonly governanceAnalyticsService: GovernanceAnalyticsService,
  ) {}

  @Get('issues')
  async listIssues(
    @Param('id') organizationId: string,
    @Query() query: Record<string, string>,
  ): Promise<PaginatedResponse<GovernanceIssueResponse>> {
    return this.governanceIssuesService.listIssues(organizationId, this.parseListQuery(query));
  }

  @Get('issues/:issueId')
  async getIssue(
    @Param('id') organizationId: string,
    @Param('issueId') issueId: string,
  ): Promise<GovernanceIssueResponse> {
    const issue = await this.governanceIssuesService.getIssue(organizationId, issueId);
    if (!issue) throw new NotFoundException('Governance issue not found');
    return issue;
  }

  @Post('issues')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'GovernanceManager')
  async createIssue(
    @Param('id') organizationId: string,
    @CurrentUser() user: User,
    @Body() body: CreateGovernanceIssueRequest,
  ): Promise<GovernanceIssueResponse> {
    if (!body?.documentId) throw new BadRequestException('documentId is required');
    if (!ISSUE_TYPE_VALUES.includes(body.issueType)) {
      throw new BadRequestException(`issueType must be one of: ${ISSUE_TYPE_VALUES.join(', ')}`);
    }
    return this.governanceIssuesService.createIssue(organizationId, user.id, body);
  }

  @Patch('issues/:issueId')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'GovernanceManager')
  async updateIssue(
    @Param('id') organizationId: string,
    @Param('issueId') issueId: string,
    @CurrentUser() user: User,
    @Body() body: UpdateGovernanceIssueRequest,
  ): Promise<GovernanceIssueResponse> {
    this.validateUpdateBody(body);
    const updated = await this.governanceIssuesService.updateIssue(organizationId, issueId, user.id, body);
    if (!updated) throw new NotFoundException('Governance issue not found');
    return updated;
  }

  @Get('summary')
  async getSummary(@Param('id') organizationId: string): Promise<GovernanceSummaryResponse> {
    return this.governanceIssuesService.getSummary(organizationId);
  }

  @Get('users')
  async listAssignableUsers(@Param('id') organizationId: string): Promise<AssignableUserResponse[]> {
    return this.governanceIssuesService.listAssignableUsers(organizationId);
  }

  @Get('issues/:issueId/activity')
  async listIssueActivity(
    @Param('id') organizationId: string,
    @Param('issueId') issueId: string,
    @Query() query: Record<string, string>,
  ): Promise<PaginatedResponse<GovernanceActivityResponse>> {
    return this.governanceActivityService.listIssueActivity(organizationId, issueId, this.parseActivityQuery(query));
  }

  @Get('activity')
  async listOrganizationActivity(
    @Param('id') organizationId: string,
    @Query() query: Record<string, string>,
  ): Promise<PaginatedResponse<GovernanceActivityResponse>> {
    return this.governanceActivityService.listOrganizationActivity(organizationId, this.parseActivityQuery(query));
  }

  @Get('analytics')
  async getAnalytics(
    @Param('id') organizationId: string,
    @Query() query: Record<string, string>,
  ): Promise<GovernanceAnalyticsResponse> {
    return this.governanceAnalyticsService.getAnalytics(organizationId, this.parseAnalyticsQuery(query));
  }

  private parseAnalyticsQuery(query: Record<string, string>): GovernanceAnalyticsQuery {
    if (query.since !== undefined && Number.isNaN(Date.parse(query.since))) {
      throw new BadRequestException('since must be a valid ISO date string');
    }
    if (query.until !== undefined && Number.isNaN(Date.parse(query.until))) {
      throw new BadRequestException('until must be a valid ISO date string');
    }
    if (query.status !== undefined && !STATUS_VALUES.includes(query.status as GovernanceIssueStatusValue)) {
      throw new BadRequestException(`status must be one of: ${STATUS_VALUES.join(', ')}`);
    }
    if (query.severity !== undefined && !SEVERITY_VALUES.includes(query.severity as IssueSeverityFilter)) {
      throw new BadRequestException(`severity must be one of: ${SEVERITY_VALUES.join(', ')}`);
    }
    if (query.issueType !== undefined && !ISSUE_TYPE_VALUES.includes(query.issueType as GovernanceIssueTypeValue)) {
      throw new BadRequestException(`issueType must be one of: ${ISSUE_TYPE_VALUES.join(', ')}`);
    }

    return {
      since: query.since,
      until: query.until,
      status: query.status as GovernanceIssueStatusValue | undefined,
      severity: query.severity as IssueSeverityFilter | undefined,
      issueType: query.issueType as GovernanceIssueTypeValue | undefined,
      assignedUserId: query.assignedUserId,
    };
  }

  private parseActivityQuery(query: Record<string, string>): GovernanceActivityListQuery {
    const page = query.page ? Number(query.page) : undefined;
    const pageSize = query.pageSize ? Number(query.pageSize) : undefined;

    if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
      throw new BadRequestException('page must be a positive integer');
    }
    if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)) {
      throw new BadRequestException('pageSize must be an integer between 1 and 100');
    }
    if (query.activityType !== undefined && !ACTIVITY_TYPE_VALUES.includes(query.activityType as GovernanceActivityTypeValue)) {
      throw new BadRequestException(`activityType must be one of: ${ACTIVITY_TYPE_VALUES.join(', ')}`);
    }
    if (query.sortDir !== undefined && !SORT_DIR_VALUES.includes(query.sortDir as SortDirection)) {
      throw new BadRequestException(`sortDir must be one of: ${SORT_DIR_VALUES.join(', ')}`);
    }
    if (query.since !== undefined && Number.isNaN(Date.parse(query.since))) {
      throw new BadRequestException('since must be a valid ISO date string');
    }
    if (query.until !== undefined && Number.isNaN(Date.parse(query.until))) {
      throw new BadRequestException('until must be a valid ISO date string');
    }

    return {
      page,
      pageSize,
      activityType: query.activityType as GovernanceActivityTypeValue | undefined,
      sortDir: query.sortDir as SortDirection | undefined,
      since: query.since,
      until: query.until,
    };
  }

  private parseListQuery(query: Record<string, string>): GovernanceIssueListQuery {
    const page = query.page ? Number(query.page) : undefined;
    const pageSize = query.pageSize ? Number(query.pageSize) : undefined;

    if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
      throw new BadRequestException('page must be a positive integer');
    }
    if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)) {
      throw new BadRequestException('pageSize must be an integer between 1 and 100');
    }
    if (query.status !== undefined && !STATUS_VALUES.includes(query.status as GovernanceIssueStatusValue)) {
      throw new BadRequestException(`status must be one of: ${STATUS_VALUES.join(', ')}`);
    }
    if (query.severity !== undefined && !SEVERITY_VALUES.includes(query.severity as IssueSeverityFilter)) {
      throw new BadRequestException(`severity must be one of: ${SEVERITY_VALUES.join(', ')}`);
    }
    if (query.issueType !== undefined && !ISSUE_TYPE_VALUES.includes(query.issueType as GovernanceIssueTypeValue)) {
      throw new BadRequestException(`issueType must be one of: ${ISSUE_TYPE_VALUES.join(', ')}`);
    }
    if (query.sortBy !== undefined && !SORT_BY_VALUES.includes(query.sortBy as 'createdAt' | 'updatedAt')) {
      throw new BadRequestException(`sortBy must be one of: ${SORT_BY_VALUES.join(', ')}`);
    }
    if (query.sortDir !== undefined && !SORT_DIR_VALUES.includes(query.sortDir as SortDirection)) {
      throw new BadRequestException(`sortDir must be one of: ${SORT_DIR_VALUES.join(', ')}`);
    }

    return {
      page,
      pageSize,
      status: query.status as GovernanceIssueStatusValue | undefined,
      severity: query.severity as IssueSeverityFilter | undefined,
      assignedUserId: query.assignedUserId,
      issueType: query.issueType as GovernanceIssueTypeValue | undefined,
      documentId: query.documentId,
      sortBy: query.sortBy as 'createdAt' | 'updatedAt' | undefined,
      sortDir: query.sortDir as SortDirection | undefined,
    };
  }

  private validateUpdateBody(body: UpdateGovernanceIssueRequest): void {
    if (body.status === undefined && body.assignedUserId === undefined && body.resolutionNotes === undefined) {
      throw new BadRequestException('At least one of status, assignedUserId, or resolutionNotes must be provided');
    }
    if (body.status !== undefined && !STATUS_VALUES.includes(body.status)) {
      throw new BadRequestException(`status must be one of: ${STATUS_VALUES.join(', ')}`);
    }
  }
}
