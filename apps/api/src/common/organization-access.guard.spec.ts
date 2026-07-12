import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { OrganizationAccessGuard } from './organization-access.guard';

function mockContext(request: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: (): Partial<Request> => request }),
  } as unknown as ExecutionContext;
}

describe('OrganizationAccessGuard', () => {
  const guard = new OrganizationAccessGuard();

  it('allows the request when the :id param matches the authenticated user organizationId', () => {
    const request: Partial<Request> = {
      params: { id: 'org-1' },
      user: { organizationId: 'org-1' } as never,
    };

    expect(guard.canActivate(mockContext(request))).toBe(true);
  });

  it('rejects with 403 when the :id param does not match the authenticated user organizationId (IDOR prevention)', () => {
    const request: Partial<Request> = {
      params: { id: 'org-attacker-supplied' },
      user: { organizationId: 'org-1' } as never,
    };

    expect(() => guard.canActivate(mockContext(request))).toThrow(ForbiddenException);
  });

  it('rejects with 403 when request.user was never set (TenantContextGuard did not run first)', () => {
    const request: Partial<Request> = { params: { id: 'org-1' } };

    expect(() => guard.canActivate(mockContext(request))).toThrow(ForbiddenException);
  });
});
