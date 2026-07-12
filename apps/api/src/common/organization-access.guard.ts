import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Validates that the :id route param matches the authenticated user's own
 * organizationId. ADR-0001/Phase 3's tenant-isolation model derives
 * organizationId from the authenticated user, never a client-supplied
 * value — this guard makes sure a client-supplied :id is only ever checked
 * against that, never trusted as the source of scoping (IDOR prevention).
 * Must run after TenantContextGuard, which sets request.user.
 */
@Injectable()
export class OrganizationAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const paramId = request.params.id;

    if (!request.user || paramId !== request.user.organizationId) {
      throw new ForbiddenException('Organization mismatch');
    }

    return true;
  }
}
