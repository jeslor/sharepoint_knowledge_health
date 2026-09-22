import { prisma } from './client';
import { backfillOrganizationEntitlements, DEFAULT_TRIAL_DOCUMENT_LIMIT } from './entitlement-backfill';

async function createBareOrganization(label: string): Promise<{ organizationId: string; siteId: string }> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const organization = await prisma.organization.create({ data: { name: `Entitlement Backfill Test Org ${unique}` } });
  const microsoftTenant = await prisma.microsoftTenant.create({
    data: { organizationId: organization.id, entraTenantId: `tenant-${unique}`, tenantName: `Test Tenant ${unique}` },
  });
  const site = await prisma.sharePointSite.create({
    data: {
      organizationId: organization.id,
      microsoftTenantId: microsoftTenant.id,
      graphSiteId: `site-${unique}`,
      siteUrl: `https://example.sharepoint.com/sites/${unique}`,
      displayName: `Test Site ${unique}`,
    },
  });

  return { organizationId: organization.id, siteId: site.id };
}

async function createActiveDocument(organizationId: string, siteId: string, suffix: string): Promise<void> {
  await prisma.document.create({
    data: {
      organizationId,
      siteId,
      graphItemId: `item-${suffix}`,
      name: `Doc ${suffix}.docx`,
      path: `/Doc ${suffix}.docx`,
      fileType: 'docx',
      sizeBytes: 1,
      sourceCreatedAt: new Date(),
      sourceModifiedAt: new Date(),
      status: 'Active',
    },
  });
}

describe('backfillOrganizationEntitlements', () => {
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

  it('creates a Trial entitlement with the correct default limit for an organization with zero documents', async () => {
    const org = await createBareOrganization('zero-docs');
    createdOrgIds.push(org.organizationId);

    const results = await backfillOrganizationEntitlements();
    const own = results.find((result) => result.organizationId === org.organizationId);

    expect(own).toBeDefined();
    expect(own?.documentLimit).toBe(DEFAULT_TRIAL_DOCUMENT_LIMIT);
    expect(own?.currentDocumentCount).toBe(0);

    const entitlement = await prisma.organizationEntitlement.findUnique({ where: { organizationId: org.organizationId } });
    expect(entitlement?.planType).toBe('Trial');
  });

  it('seeds currentDocumentCount from the organization\'s REAL current Active-document count, never a hardcoded zero', async () => {
    const org = await createBareOrganization('with-docs');
    createdOrgIds.push(org.organizationId);
    await createActiveDocument(org.organizationId, org.siteId, 'a');
    await createActiveDocument(org.organizationId, org.siteId, 'b');
    await createActiveDocument(org.organizationId, org.siteId, 'c');

    await backfillOrganizationEntitlements();

    const entitlement = await prisma.organizationEntitlement.findUnique({ where: { organizationId: org.organizationId } });
    expect(entitlement?.currentDocumentCount).toBe(3);
  });

  it('excludes Removed documents from the seeded count', async () => {
    const org = await createBareOrganization('with-removed-docs');
    createdOrgIds.push(org.organizationId);
    await createActiveDocument(org.organizationId, org.siteId, 'active-1');
    await prisma.document.create({
      data: {
        organizationId: org.organizationId,
        siteId: org.siteId,
        graphItemId: 'item-removed-1',
        name: 'Removed.docx',
        path: '/Removed.docx',
        fileType: 'docx',
        sizeBytes: 1,
        sourceCreatedAt: new Date(),
        sourceModifiedAt: new Date(),
        status: 'Removed',
      },
    });

    await backfillOrganizationEntitlements();

    const entitlement = await prisma.organizationEntitlement.findUnique({ where: { organizationId: org.organizationId } });
    expect(entitlement?.currentDocumentCount).toBe(1);
  });

  it('is idempotent — never touches an organization that already has an entitlement', async () => {
    const org = await createBareOrganization('already-entitled');
    createdOrgIds.push(org.organizationId);
    await createActiveDocument(org.organizationId, org.siteId, 'a');

    const firstRun = await backfillOrganizationEntitlements();
    expect(firstRun.some((result) => result.organizationId === org.organizationId)).toBe(true);

    // Simulate real, subsequent usage after the first backfill — a second
    // run must never overwrite this with a re-derived count.
    await prisma.organizationEntitlement.update({
      where: { organizationId: org.organizationId },
      data: { currentDocumentCount: 500 },
    });

    const secondRun = await backfillOrganizationEntitlements();
    expect(secondRun.some((result) => result.organizationId === org.organizationId)).toBe(false);

    const entitlement = await prisma.organizationEntitlement.findUnique({ where: { organizationId: org.organizationId } });
    expect(entitlement?.currentDocumentCount).toBe(500);
  });

  it('never affects a different organization\'s document count when backfilling', async () => {
    const orgA = await createBareOrganization('isolation-a');
    const orgB = await createBareOrganization('isolation-b');
    createdOrgIds.push(orgA.organizationId, orgB.organizationId);
    await createActiveDocument(orgA.organizationId, orgA.siteId, 'a1');
    await createActiveDocument(orgA.organizationId, orgA.siteId, 'a2');
    await createActiveDocument(orgB.organizationId, orgB.siteId, 'b1');

    await backfillOrganizationEntitlements();

    const entitlementA = await prisma.organizationEntitlement.findUnique({ where: { organizationId: orgA.organizationId } });
    const entitlementB = await prisma.organizationEntitlement.findUnique({ where: { organizationId: orgB.organizationId } });
    expect(entitlementA?.currentDocumentCount).toBe(2);
    expect(entitlementB?.currentDocumentCount).toBe(1);
  });
});
