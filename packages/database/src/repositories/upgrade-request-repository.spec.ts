import { prisma } from '../client';
import { createTenantContext } from '../tenant-context';

interface SeededOrg {
  organizationId: string;
  userId: string;
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const organization = await prisma.organization.create({
    data: { name: `Upgrade Request Test Org ${unique}` },
  });

  const microsoftTenant = await prisma.microsoftTenant.create({
    data: {
      organizationId: organization.id,
      entraTenantId: `tenant-${unique}`,
      tenantName: `Test Tenant ${unique}`,
    },
  });

  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      microsoftTenantId: microsoftTenant.id,
      entraObjectId: `entra-${unique}`,
      email: `${unique}@example.com`,
      displayName: `Test User ${unique}`,
    },
  });

  return { organizationId: organization.id, userId: user.id };
}

describe('UpgradeRequestRepository (Phase 6)', () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
      createdOrgIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates an UpgradeRequest scoped to the bound organization, defaulting to Pending', async () => {
    const org = await seedOrg('create-basic');
    createdOrgIds.push(org.organizationId);

    const created = await createTenantContext(org.organizationId).upgradeRequests.create({
      requestedByUserId: org.userId,
      message: 'We expect to grow past 2,000 documents soon.',
    });

    expect(created.organizationId).toBe(org.organizationId);
    expect(created.requestedByUserId).toBe(org.userId);
    expect(created.status).toBe('Pending');
    expect(created.message).toBe('We expect to grow past 2,000 documents soon.');
  });

  it('allows a null message (optional field)', async () => {
    const org = await seedOrg('create-no-message');
    createdOrgIds.push(org.organizationId);

    const created = await createTenantContext(org.organizationId).upgradeRequests.create({
      requestedByUserId: org.userId,
      message: null,
    });

    expect(created.message).toBeNull();
  });

  it('findMany never returns another organization\'s requests', async () => {
    const orgA = await seedOrg('isolation-a');
    const orgB = await seedOrg('isolation-b');
    createdOrgIds.push(orgA.organizationId, orgB.organizationId);

    await createTenantContext(orgA.organizationId).upgradeRequests.create({ requestedByUserId: orgA.userId, message: null });
    await createTenantContext(orgB.organizationId).upgradeRequests.create({ requestedByUserId: orgB.userId, message: null });

    const orgARequests = await createTenantContext(orgA.organizationId).upgradeRequests.findMany();

    expect(orgARequests).toHaveLength(1);
    expect(orgARequests[0]?.organizationId).toBe(orgA.organizationId);
  });

  it('supports filtering by requestedByUserId and a createdAt window — the duplicate-submission guard\'s own query shape', async () => {
    const org = await seedOrg('duplicate-window-query');
    createdOrgIds.push(org.organizationId);
    const context = createTenantContext(org.organizationId);

    await context.upgradeRequests.create({ requestedByUserId: org.userId, message: null });

    const recent = await context.upgradeRequests.findMany({
      where: { requestedByUserId: org.userId, createdAt: { gt: new Date(Date.now() - 60_000) } },
      take: 1,
    });

    expect(recent).toHaveLength(1);
  });
});
