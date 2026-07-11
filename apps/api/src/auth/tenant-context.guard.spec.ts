import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import {
  createTenantContext,
  findMicrosoftTenantByEntraTenantId,
  findUserByEntraIdentity,
  provisionUserFromExistingTenant,
} from '@sph/database';
import type { Request } from 'express';
import { TenantContextGuard } from './tenant-context.guard';

jest.mock('@sph/database');

const mockedFindUser = findUserByEntraIdentity as jest.MockedFunction<typeof findUserByEntraIdentity>;
const mockedFindTenants = findMicrosoftTenantByEntraTenantId as jest.MockedFunction<
  typeof findMicrosoftTenantByEntraTenantId
>;
const mockedProvision = provisionUserFromExistingTenant as jest.MockedFunction<typeof provisionUserFromExistingTenant>;
const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

function mockContext(request: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: (): Partial<Request> => request }),
  } as unknown as ExecutionContext;
}

describe('TenantContextGuard', () => {
  const guard = new TenantContextGuard();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws if EntraJwtGuard has not already resolved entraClaims', async () => {
    await expect(guard.canActivate(mockContext({}))).rejects.toThrow(UnauthorizedException);
  });

  it('attaches user and tenantContext for an Active, already-known user', async () => {
    const request: Partial<Request> = { entraClaims: { tid: 'tid-1', oid: 'oid-1' } };
    mockedFindUser.mockResolvedValue({ id: 'user-1', organizationId: 'org-1', status: 'Active' } as never);
    mockedCreateContext.mockReturnValue({ organizationId: 'org-1' } as never);

    const result = await guard.canActivate(mockContext(request));

    expect(result).toBe(true);
    expect(request.user?.id).toBe('user-1');
    expect(request.tenantContext).toEqual({ organizationId: 'org-1' });
    expect(mockedProvision).not.toHaveBeenCalled();
  });

  it('rejects a PendingApproval user — API authorization denies access (ADR-0012 Acceptance Criteria #4)', async () => {
    const request: Partial<Request> = { entraClaims: { tid: 'tid-1', oid: 'oid-1' } };
    mockedFindUser.mockResolvedValue({ id: 'user-1', organizationId: 'org-1', status: 'PendingApproval' } as never);

    await expect(guard.canActivate(mockContext(request))).rejects.toThrow(ForbiddenException);
    expect(request.tenantContext).toBeUndefined();
  });

  it('rejects a Deactivated user', async () => {
    const request: Partial<Request> = { entraClaims: { tid: 'tid-1', oid: 'oid-1' } };
    mockedFindUser.mockResolvedValue({ id: 'user-1', organizationId: 'org-1', status: 'Deactivated' } as never);

    await expect(guard.canActivate(mockContext(request))).rejects.toThrow(ForbiddenException);
  });

  it('provisions a new pending user for a first sighting against an already-Consented tenant, then still denies access', async () => {
    const request: Partial<Request> = { entraClaims: { tid: 'tid-1', oid: 'oid-1', email: 'a@b.com', name: 'A' } };
    mockedFindUser.mockResolvedValue(null);
    mockedFindTenants.mockResolvedValue([{ id: 'tenant-1', organizationId: 'org-1', status: 'Consented' } as never]);
    mockedProvision.mockResolvedValue({ id: 'user-new', status: 'PendingApproval' } as never);

    await expect(guard.canActivate(mockContext(request))).rejects.toThrow(ForbiddenException);
    expect(mockedProvision).toHaveBeenCalledWith(
      { id: 'tenant-1', organizationId: 'org-1', status: 'Consented' },
      'oid-1',
      { email: 'a@b.com', displayName: 'A' },
    );
  });

  it('rejects outright, never provisioning, when no MicrosoftTenant exists for the tid at all', async () => {
    const request: Partial<Request> = { entraClaims: { tid: 'tid-unknown', oid: 'oid-1' } };
    mockedFindUser.mockResolvedValue(null);
    mockedFindTenants.mockResolvedValue([]);

    await expect(guard.canActivate(mockContext(request))).rejects.toThrow(ForbiddenException);
    expect(mockedProvision).not.toHaveBeenCalled();
  });

  it('rejects when a MicrosoftTenant exists for the tid but has never completed consent', async () => {
    const request: Partial<Request> = { entraClaims: { tid: 'tid-1', oid: 'oid-1' } };
    mockedFindUser.mockResolvedValue(null);
    mockedFindTenants.mockResolvedValue([
      { id: 'tenant-1', organizationId: 'org-1', status: 'PendingConsent' } as never,
    ]);

    await expect(guard.canActivate(mockContext(request))).rejects.toThrow(ForbiddenException);
    expect(mockedProvision).not.toHaveBeenCalled();
  });
});
