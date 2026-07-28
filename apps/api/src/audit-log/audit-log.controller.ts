import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { AuditLogListQuery, AuditLogResponse, PaginatedResponse, SortDirection } from '@sph/types';
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { AuditLogService } from './audit-log.service';

const SORT_DIR_VALUES: SortDirection[] = ['asc', 'desc'];

/**
 * ADR-0019 §4: audit visibility is a separate concern from the ability to
 * perform the audited actions themselves. No RolesGuard/@Roles here,
 * deliberately — any authenticated org member may read this, matching
 * governance activity's own "no role restriction on reads" convention
 * (only mutations carry a Roles guard anywhere in this API).
 */
@Controller('organizations/:id/audit-log')
@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  async list(
    @Param('id') organizationId: string,
    @Query() query: Record<string, string>,
  ): Promise<PaginatedResponse<AuditLogResponse>> {
    return this.auditLogService.list(organizationId, this.parseQuery(query));
  }

  private parseQuery(query: Record<string, string>): AuditLogListQuery {
    const page = query.page ? Number(query.page) : undefined;
    const pageSize = query.pageSize ? Number(query.pageSize) : undefined;

    if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
      throw new BadRequestException('page must be a positive integer');
    }
    if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)) {
      throw new BadRequestException('pageSize must be an integer between 1 and 100');
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
      action: query.action,
      targetType: query.targetType,
      sortDir: query.sortDir as SortDirection | undefined,
      since: query.since,
      until: query.until,
    };
  }
}
