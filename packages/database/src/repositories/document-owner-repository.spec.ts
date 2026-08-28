import { prisma } from '../client';
import { createTenantContext } from '../tenant-context';

interface SeededOrg {
  organizationId: string;
  siteId: string;
  documentIds: string[];
}

/**
 * Mirrors sharepoint-review-date-mapping-repository.spec.ts's seedOrg
 * precedent — a real, independent data tree via raw prisma calls, trimmed
 * to only what DocumentOwner's FKs require (SharePointSite, Document).
 */
async function seedOrg(label: string, documentCount = 2): Promise<SeededOrg> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const organization = await prisma.organization.create({
    data: { name: `DocumentOwner Repository Test Org ${unique}` },
  });

  const microsoftTenant = await prisma.microsoftTenant.create({
    data: {
      organizationId: organization.id,
      entraTenantId: `tenant-${unique}`,
      tenantName: `Test Tenant ${unique}`,
    },
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

  const documentIds: string[] = [];
  for (let i = 0; i < documentCount; i += 1) {
    const document = await prisma.document.create({
      data: {
        organizationId: organization.id,
        siteId: site.id,
        graphItemId: `item-${unique}-${i}`,
        name: `Test Document ${unique}-${i}.docx`,
        path: `/sites/${unique}/Test Document ${i}.docx`,
        fileType: 'docx',
        sizeBytes: 1024,
        sourceCreatedAt: new Date(),
        sourceModifiedAt: new Date(),
      },
    });
    documentIds.push(document.id);
  }

  return { organizationId: organization.id, siteId: site.id, documentIds };
}

describe('DocumentOwnerRepository.groupBySource (ADR-0024 Phase A)', () => {
  let org: SeededOrg;

  beforeEach(async () => {
    org = await seedOrg('group-by-source', 2);
  }, 30_000);

  afterEach(async () => {
    await prisma.organization.delete({ where: { id: org.organizationId } });
  }, 30_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns a count per source, scoped to the given where clause', async () => {
    const context = createTenantContext(org.organizationId);
    const [docA, docB] = org.documentIds;

    await context.documentOwners.create({ documentId: docA!, ownerType: 'Author', source: 'GraphMetadata', email: 'a@example.com' });
    await context.documentOwners.create({ documentId: docA!, ownerType: 'AssignedOwner', source: 'ManualAssignment', email: 'b@example.com' });
    await context.documentOwners.create({ documentId: docB!, ownerType: 'AssignedOwner', source: 'ManualAssignment', email: 'c@example.com' });

    const results = await context.documentOwners.groupBySource({ documentId: { in: org.documentIds } });

    const bySource = new Map(results.map((result) => [result.source, result.count]));
    expect(bySource.get('GraphMetadata')).toBe(1);
    expect(bySource.get('ManualAssignment')).toBe(2);
  });

  it('returns an empty array when no owners match the where clause', async () => {
    const context = createTenantContext(org.organizationId);

    const results = await context.documentOwners.groupBySource({ documentId: { in: org.documentIds } });

    expect(results).toEqual([]);
  });

  it('never includes counts for owners belonging to a different organization', async () => {
    const otherOrg = await seedOrg('group-by-source-other', 1);
    try {
      const context = createTenantContext(org.organizationId);
      const otherContext = createTenantContext(otherOrg.organizationId);

      await context.documentOwners.create({ documentId: org.documentIds[0]!, ownerType: 'Author', source: 'GraphMetadata', email: 'a@example.com' });
      await otherContext.documentOwners.create({ documentId: otherOrg.documentIds[0]!, ownerType: 'Author', source: 'GraphMetadata', email: 'z@example.com' });

      const results = await context.documentOwners.groupBySource({});

      const total = results.reduce((sum, result) => sum + result.count, 0);
      expect(total).toBe(1);
    } finally {
      await prisma.organization.delete({ where: { id: otherOrg.organizationId } });
    }
  });
});
