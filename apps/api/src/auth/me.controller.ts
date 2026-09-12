import { Controller, Get, UseGuards } from '@nestjs/common';
import { createTenantContext, derivePermissionReconsentState, type User } from '@sph/database';
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

    // ADR-0023 §3.4/§3.10: derived at read time from the same row already
    // fetched above — no extra query. Both flags are false whenever there's
    // no Consented tenant at all (nothing to reconsent).
    const reconsent = consentedTenant ? derivePermissionReconsentState(consentedTenant) : null;

    return {
      id: user.id,
      role: user.role,
      organizationId: user.organizationId,
      displayName: user.displayName,
      email: user.email,
      tenantName: consentedTenant?.tenantName ?? null,
      needsReconsent: reconsent?.needsReconsent ?? false,
      // ADR-0022 write-back MVP: the write-back-specific slice — gates the
      // remediation UI so a doomed job (missing Sites.ReadWrite.All) is
      // never submitted. The API remains the authoritative gate
      // (RemediationService); this only drives proactive UI disabling.
      needsWriteConsent: reconsent?.needsWriteConsentAssertion ?? false,
    };
  }
}
