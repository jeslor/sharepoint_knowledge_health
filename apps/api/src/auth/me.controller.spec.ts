import { createTenantContext, derivePermissionReconsentState, type User } from '@sph/database';
import { MeController } from './me.controller';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;
const mockedDerivePermissionReconsentState = derivePermissionReconsentState as jest.MockedFunction<typeof derivePermissionReconsentState>;

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    organizationId: 'org-1',
    microsoftTenantId: 'tenant-1',
    entraObjectId: 'entra-1',
    email: 'sarah@contoso.com',
    displayName: 'Sarah Kim',
    role: 'Admin',
    status: 'Active',
    createdAt: new Date(),
    lastLoginAt: null,
    ...overrides,
  } as User;
}

describe('MeController', () => {
  const microsoftTenants = { findMany: jest.fn() };
  const organization = { get: jest.fn() };
  const controller = new MeController();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ microsoftTenants, organization } as never);
    organization.get.mockResolvedValue({ id: 'org-1', name: 'Contoso Corp' });
    mockedDerivePermissionReconsentState.mockReturnValue({
      needsReadReconsent: false,
      needsWriteConsentAssertion: false,
      needsReconsent: false,
    });
  });

  it('returns the user identity plus the connected tenant name and the organization name', async () => {
    microsoftTenants.findMany.mockResolvedValue([{ tenantName: 'Contoso Ltd.' }]);

    const result = await controller.getMe(user());

    expect(mockedCreateContext).toHaveBeenCalledWith('org-1');
    expect(microsoftTenants.findMany).toHaveBeenCalledWith({ where: { status: 'Consented' }, take: 1 });
    expect(result).toEqual({
      id: 'user-1',
      role: 'Admin',
      organizationId: 'org-1',
      displayName: 'Sarah Kim',
      email: 'sarah@contoso.com',
      organizationName: 'Contoso Corp',
      tenantName: 'Contoso Ltd.',
      needsReconsent: false,
      needsWriteConsent: false,
    });
  });

  // Phase 6: organizationName feeds the "Request an upgrade" dialog's
  // display-only context — must never crash /auth/me even in the
  // structurally-unexpected case of a missing Organization row.
  it('falls back to an empty organizationName rather than throwing if the organization row is somehow missing', async () => {
    microsoftTenants.findMany.mockResolvedValue([]);
    organization.get.mockResolvedValue(null);

    const result = await controller.getMe(user());

    expect(result.organizationName).toBe('');
  });

  it('returns tenantName: null and both reconsent signals false when there is no Consented Microsoft tenant', async () => {
    microsoftTenants.findMany.mockResolvedValue([]);

    const result = await controller.getMe(user());

    expect(result.tenantName).toBeNull();
    expect(result.needsReconsent).toBe(false);
    expect(result.needsWriteConsent).toBe(false);
    // Nothing to derive a reconsent state from — must not be called at all.
    expect(mockedDerivePermissionReconsentState).not.toHaveBeenCalled();
  });

  it('exposes needsWriteConsent from the tenant row so the UI can gate write-back (ADR-0022 write-back MVP)', async () => {
    const tenant = { tenantName: 'Contoso Ltd.', status: 'Consented', verifiedReadPermissionVersion: 2, consentAssertedPermissionVersion: 1 };
    microsoftTenants.findMany.mockResolvedValue([tenant]);
    mockedDerivePermissionReconsentState.mockReturnValue({
      needsReadReconsent: false,
      needsWriteConsentAssertion: true,
      needsReconsent: true,
    });

    const result = await controller.getMe(user());

    expect(result.needsWriteConsent).toBe(true);
  });

  it('derives needsReconsent from the connected tenant row (ADR-0023) rather than computing it inline', async () => {
    const tenant = {
      tenantName: 'Contoso Ltd.',
      status: 'Consented',
      verifiedReadPermissionVersion: null,
      consentAssertedPermissionVersion: null,
    };
    microsoftTenants.findMany.mockResolvedValue([tenant]);
    mockedDerivePermissionReconsentState.mockReturnValue({
      needsReadReconsent: true,
      needsWriteConsentAssertion: true,
      needsReconsent: true,
    });

    const result = await controller.getMe(user());

    expect(mockedDerivePermissionReconsentState).toHaveBeenCalledWith(tenant);
    expect(result.needsReconsent).toBe(true);
  });
});
