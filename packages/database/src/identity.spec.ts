import { prisma } from './client';
import { findUserByEntraIdentity } from './identity';

interface SeededIdentity {
  organizationId: string;
  microsoftTenantId: string;
  entraTenantId: string;
  userId: string;
  entraObjectId: string;
}

/**
 * Bootstraps one Organization -> MicrosoftTenant -> User chain, bypassing
 * the tenant context (raw prisma.*.create) — legitimate here since these
 * are the fixtures identity resolution itself is tested against.
 */
async function seedIdentity(label: string, entraObjectId: string): Promise<SeededIdentity> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const organization = await prisma.organization.create({
    data: { name: `Identity Test Org ${unique}` },
  });

  const entraTenantId = `tid-${unique}`;
  const microsoftTenant = await prisma.microsoftTenant.create({
    data: {
      organizationId: organization.id,
      entraTenantId,
      tenantName: `Identity Test Tenant ${unique}`,
    },
  });

  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      microsoftTenantId: microsoftTenant.id,
      entraObjectId,
      email: `${unique}@example.com`,
      displayName: `Identity Test User ${unique}`,
    },
  });

  return {
    organizationId: organization.id,
    microsoftTenantId: microsoftTenant.id,
    entraTenantId,
    userId: user.id,
    entraObjectId,
  };
}

describe('findUserByEntraIdentity (ADR-0010)', () => {
  let tenantA: SeededIdentity;
  let tenantB: SeededIdentity;
  let tenantC: SeededIdentity;

  const sharedOid = `oid-shared-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const otherOid = `oid-other-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
    // A and B share the same oid but live under different Azure AD tenants
    // — this is the rare-but-real collision scenario the compound unique
    // (microsoftTenantId + entraObjectId) exists to handle correctly.
    tenantA = await seedIdentity('tenant-a', sharedOid);
    tenantB = await seedIdentity('tenant-b', sharedOid);
    // C has a distinct oid entirely, used for the "correct tid, wrong oid" case.
    tenantC = await seedIdentity('tenant-c', otherOid);
  }, 30_000);

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [tenantA.organizationId, tenantB.organizationId, tenantC.organizationId] } },
    });
    await prisma.$disconnect();
  }, 30_000);

  it('resolves the same oid to the correct, different user in each tenant', async () => {
    const userFromA = await findUserByEntraIdentity(tenantA.entraTenantId, sharedOid);
    const userFromB = await findUserByEntraIdentity(tenantB.entraTenantId, sharedOid);

    expect(userFromA?.id).toBe(tenantA.userId);
    expect(userFromB?.id).toBe(tenantB.userId);
    expect(userFromA?.id).not.toBe(userFromB?.id);
    expect(userFromA?.organizationId).toBe(tenantA.organizationId);
    expect(userFromB?.organizationId).toBe(tenantB.organizationId);
  });

  it('fails to resolve when the tid is wrong, even with the correct oid', async () => {
    // sharedOid exists under tenants A and B, but not under tenant C.
    const result = await findUserByEntraIdentity(tenantC.entraTenantId, sharedOid);
    expect(result).toBeNull();
  });

  it('fails to resolve when the oid is wrong, even with the correct tid', async () => {
    // otherOid exists under tenant C, but not under tenant A.
    const result = await findUserByEntraIdentity(tenantA.entraTenantId, otherOid);
    expect(result).toBeNull();
  });

  it('fails to resolve an entirely unknown tid/oid pair', async () => {
    const result = await findUserByEntraIdentity('unknown-tid', 'unknown-oid');
    expect(result).toBeNull();
  });
});
