import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import type { OrganizationUserResponse } from '@sph/types';
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { UsersService } from './users.service';

/**
 * Phase 9.5: every route here is Admin-only (class-level, not per-method —
 * unlike sibling controllers, there is no "any active user" read case for
 * a full org roster including pending/deactivated accounts), matching every
 * other organization-management action already Admin-only in this codebase
 * (site approval, tenant connection, scan scheduling).
 */
@Controller('organizations/:id/users')
@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard, RolesGuard)
@Roles('Admin')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async listUsers(@Param('id') organizationId: string): Promise<OrganizationUserResponse[]> {
    return this.usersService.listUsers(organizationId);
  }

  @Patch(':userId/approve')
  async approveUser(
    @Param('id') organizationId: string,
    @Param('userId') userId: string,
  ): Promise<OrganizationUserResponse> {
    return this.usersService.approveUser(organizationId, userId);
  }

  @Patch(':userId/reject')
  async rejectUser(
    @Param('id') organizationId: string,
    @Param('userId') userId: string,
  ): Promise<OrganizationUserResponse> {
    return this.usersService.rejectUser(organizationId, userId);
  }
}
