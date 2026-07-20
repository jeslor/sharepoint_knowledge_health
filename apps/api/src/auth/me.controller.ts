import { Controller, Get, UseGuards } from '@nestjs/common';
import { createTenantContext, type User } from '@sph/database';
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
  async getMe(@CurrentUser() user: User): Promise<MeResponse> {
    const context = createTenantContext(user.organizationId);
    const [consentedTenant] = await context.microsoftTenants.findMany({ where: { status: 'Consented' }, take: 1 });

    return {
      id: user.id,
      role: user.role,
      organizationId: user.organizationId,
      displayName: user.displayName,
      email: user.email,
      tenantName: consentedTenant?.tenantName ?? null,
    };
  }
}
