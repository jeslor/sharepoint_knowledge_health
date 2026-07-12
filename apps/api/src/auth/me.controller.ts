import { Controller, Get, UseGuards } from '@nestjs/common';
import type { User } from '@sph/database';
import type { MeResponse } from '@sph/types';
import { EntraJwtGuard } from './entra-jwt.guard';
import { TenantContextGuard } from './tenant-context.guard';
import { CurrentUser } from './current-user.decorator';

/**
 * Minimal endpoint proving the full guard chain works end-to-end — the
 * same role /health played in Phase 1. No Microsoft Graph calls.
 */
@Controller('auth')
export class MeController {
  @Get('me')
  @UseGuards(EntraJwtGuard, TenantContextGuard)
  getMe(@CurrentUser() user: User): MeResponse {
    return {
      id: user.id,
      role: user.role,
      organizationId: user.organizationId,
    };
  }
}
