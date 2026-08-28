import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RolesGuard } from './roles.guard';

// Mirrors organization-access.guard.spec.ts's exact mock-ExecutionContext
// convention. RolesGuard additionally reads getHandler()/getClass() (fed
// into Reflector.getAllAndOverride), so those are stubbed too — their
// return values are irrelevant here since the Reflector itself is mocked.
function mockContext(request: Partial<Request>): ExecutionContext {
  return {
    getHandler: () => (): void => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: (): Partial<Request> => request }),
  } as unknown as ExecutionContext;
}

// No dedicated spec existed for this guard before — it was previously only
// ever exercised indirectly through whichever controller happened to
// declare @Roles(...). Added here (not as a remediation-specific test)
// because Phase 6's POST /remediation-jobs relies on this exact,
// unmodified class for its Admin/GovernanceManager restriction, and the
// class itself had no direct coverage proving Admin/GovernanceManager pass
// and Member is rejected.
describe('RolesGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new RolesGuard(reflector as unknown as Reflector);

  beforeEach(() => jest.clearAllMocks());

  it('allows the request when no @Roles metadata is present on the route (no-op by default)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const request: Partial<Request> = { user: { role: 'Member' } as never };

    expect(guard.canActivate(mockContext(request))).toBe(true);
  });

  it("allows an Admin through a route restricted to @Roles('Admin', 'GovernanceManager') — Bulk Remediation job creation's exact restriction", () => {
    reflector.getAllAndOverride.mockReturnValue(['Admin', 'GovernanceManager']);
    const request: Partial<Request> = { user: { role: 'Admin' } as never };

    expect(guard.canActivate(mockContext(request))).toBe(true);
  });

  it("allows a GovernanceManager through a route restricted to @Roles('Admin', 'GovernanceManager')", () => {
    reflector.getAllAndOverride.mockReturnValue(['Admin', 'GovernanceManager']);
    const request: Partial<Request> = { user: { role: 'GovernanceManager' } as never };

    expect(guard.canActivate(mockContext(request))).toBe(true);
  });

  it("rejects a Member with 403 on a route restricted to @Roles('Admin', 'GovernanceManager')", () => {
    reflector.getAllAndOverride.mockReturnValue(['Admin', 'GovernanceManager']);
    const request: Partial<Request> = { user: { role: 'Member' } as never };

    expect(() => guard.canActivate(mockContext(request))).toThrow(ForbiddenException);
  });

  it('rejects with 403 when request.user was never set (TenantContextGuard did not run first)', () => {
    reflector.getAllAndOverride.mockReturnValue(['Admin']);
    const request: Partial<Request> = {};

    expect(() => guard.canActivate(mockContext(request))).toThrow(ForbiddenException);
  });
});
