import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { HealthTrendResponse } from '@sph/types';
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { HealthTrendsService } from './health-trends.service';

const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 365;

@Controller('organizations/:id')
@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)
export class HealthTrendsController {
  constructor(private readonly healthTrendsService: HealthTrendsService) {}

  @Get('health-trends')
  async getOrganizationTrend(
    @Param('id') organizationId: string,
    @Query('days') daysParam?: string,
  ): Promise<HealthTrendResponse> {
    const days = this.parseDays(daysParam);
    return this.healthTrendsService.getOrganizationTrend(organizationId, days);
  }

  private parseDays(daysParam?: string): number {
    if (daysParam === undefined) return DEFAULT_DAYS;
    const days = Number(daysParam);
    if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
      throw new BadRequestException(`days must be an integer between ${MIN_DAYS} and ${MAX_DAYS}`);
    }
    return days;
  }
}
