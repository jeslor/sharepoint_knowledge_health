import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  createTenantContext,
  findMicrosoftTenantByEntraTenantId,
  findUserByEntraIdentity,
  provisionUserFromExistingTenant,
} from '@sph/database';
import type { Request } from 'express';

/**
 * ADR-0012's decision tree for a REGULAR protected request — deliberately
 * narrower than the dedicated consent-callback flow: it will provision a
 * new, PendingApproval user under an already-Consented MicrosoftTenant, but
 * it will NEVER bootstrap a brand-new Organization. An unrecognized tid
 * with no connected tenant at all is rejected outright — org bootstrap only
 * happens through the explicit admin-consent callback endpoint.
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const claims = request.entraClaims;
    if (!claims) {
      // EntraJwtGuard must run first in the guard chain — structurally
      // unreachable otherwise.
      throw new UnauthorizedException('Identity not resolved');
    }

    let user = await findUserByEntraIdentity(claims.tid, claims.oid);

    if (!user) {
      const candidates = await findMicrosoftTenantByEntraTenantId(claims.tid);
      const consented = candidates.find((tenant) => tenant.status === 'Consented');
      if (!consented) {
        throw new ForbiddenException('Organization not connected');
      }
      user = await provisionUserFromExistingTenant(consented, claims.oid, {
        email: claims.email ?? '',
        displayName: claims.name ?? '',
      });
    }

    if (user.status !== 'Active') {
      throw new ForbiddenException('Account pending approval');
    }

    request.user = user;
    request.tenantContext = createTenantContext(user.organizationId);
    return true;
  }
}
