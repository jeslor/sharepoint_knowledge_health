import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@sph/database';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User => {
  const request = ctx.switchToHttp().getRequest<Request>();
  if (!request.user) {
    throw new Error('@CurrentUser() used outside a route protected by TenantContextGuard');
  }
  return request.user;
});
