import { createTenantContext, type User } from '@sph/database';
import { MeController } from './me.controller';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

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
  const controller = new MeController();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ microsoftTenants } as never);
  });

  it('returns the user identity plus the connected tenant name', async () => {
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
      tenantName: 'Contoso Ltd.',
    });
  });

  it('returns tenantName: null when there is no Consented Microsoft tenant', async () => {
    microsoftTenants.findMany.mockResolvedValue([]);

    const result = await controller.getMe(user());

    expect(result.tenantName).toBeNull();
  });
});
