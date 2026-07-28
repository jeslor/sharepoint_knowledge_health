import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { User } from '@sph/database';
import type { CreateScanScheduleRequest, ScanScheduleFrequencyValue, ScanScheduleResponse, UpdateScanScheduleRequest } from '@sph/types';
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { ScanScheduleService } from './scan-schedule.service';

const VALID_FREQUENCIES: ScanScheduleFrequencyValue[] = ['Daily', 'Weekly'];

@Controller('organizations/:id')
@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)
export class ScanScheduleController {
  constructor(private readonly scanScheduleService: ScanScheduleService) {}

  @Get('scan-schedule')
  async getSchedule(@Param('id') organizationId: string): Promise<ScanScheduleResponse | null> {
    return this.scanScheduleService.getSchedule(organizationId);
  }

  @Post('scan-schedule')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  async createSchedule(
    @Param('id') organizationId: string,
    @Body() body: CreateScanScheduleRequest,
    @CurrentUser() actor: User,
  ): Promise<ScanScheduleResponse> {
    this.validateFrequency(body.frequency);
    return this.scanScheduleService.createSchedule(organizationId, body, actor.id);
  }

  @Patch('scan-schedule')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  async updateSchedule(
    @Param('id') organizationId: string,
    @Body() body: UpdateScanScheduleRequest,
    @CurrentUser() actor: User,
  ): Promise<ScanScheduleResponse> {
    if (body.frequency === undefined && body.enabled === undefined) {
      throw new BadRequestException('At least one of frequency or enabled must be provided');
    }
    if (body.frequency !== undefined) this.validateFrequency(body.frequency);
    return this.scanScheduleService.updateSchedule(organizationId, body, actor.id);
  }

  @Delete('scan-schedule')
  @UseGuards(RolesGuard)
  @Roles('Admin')
  @HttpCode(204)
  async deleteSchedule(@Param('id') organizationId: string): Promise<void> {
    return this.scanScheduleService.deleteSchedule(organizationId);
  }

  private validateFrequency(frequency: unknown): void {
    if (!VALID_FREQUENCIES.includes(frequency as ScanScheduleFrequencyValue)) {
      throw new BadRequestException(`frequency must be one of: ${VALID_FREQUENCIES.join(', ')}`);
    }
  }
}
