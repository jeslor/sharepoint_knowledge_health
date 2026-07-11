import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantContext } from '@sph/database';

export const CurrentTenantContext = createParamDecorator((_data: unknown, ctx: ExecutionContext): TenantContext => {
  const request = ctx.switchToHttp().getRequest<Request>();
  if (!request.tenantContext) {
    throw new Error('@CurrentTenantContext() used outside a route protected by TenantContextGuard');
  }
  return request.tenantContext;
});
