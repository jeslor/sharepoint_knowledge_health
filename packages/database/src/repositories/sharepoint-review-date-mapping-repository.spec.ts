import { prisma } from '../client';
import { createTenantContext } from '../tenant-context';

interface SeededOrg {
  organizationId: string;
  siteId: string;
  userId: string;
}

/**
 * Mirrors notification-repository.spec.ts's seedOrgWithIssue precedent — a
 * real, independent data tree via raw prisma calls, trimmed to only what
 * upsertActive's FKs require (SharePointSite, User).
 */
async function seedOrg(label: string): Promise<SeededOrg> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const organization = await prisma.organization.create({
    data: { name: `Review-Date Mapping Repository Test Org ${unique}` },
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

  const site = await prisma.sharePointSite.create({
    data: {
      organizationId: organization.id,
      microsoftTenantId: microsoftTenant.id,
      graphSiteId: `site-${unique}`,
      siteUrl: `https://example.sharepoint.com/sites/${unique}`,
      displayName: `Test Site ${unique}`,
    },
  });

  return { organizationId: organization.id, siteId: site.id, userId: user.id };
}

describe('SharePointReviewDateMappingRepository.upsertActive (confirmation-race hardening)', () => {
  let org: SeededOrg;

  beforeEach(async () => {
    org = await seedOrg('upsert-active');
  }, 30_000);

  afterEach(async () => {
    await prisma.organization.delete({ where: { id: org.organizationId } });
  }, 30_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function upsertInput(graphListId: string) {
    return {
      siteId: org.siteId,
      graphListId,
      columnDefinitionId: 'col-1',
      columnDisplayNameAtConfirmation: 'Review Date',
      confirmedByUserId: org.userId,
    };
  }

  it('creates exactly one mapping when two first-time confirmations race for the same library — the core concurrency guarantee', async () => {
    const context = createTenantContext(org.organizationId);
    const graphListId = 'list-concurrent';

    // Two "simultaneous" confirm requests for the same never-before-mapped
    // library (e.g. a double-click, or two admins confirming at once) —
    // this is exactly the race the API-layer review identified.
    const [first, second] = await Promise.all([
      context.sharePointReviewDateMappings.upsertActive(upsertInput(graphListId)),
      context.sharePointReviewDateMappings.upsertActive(upsertInput(graphListId)),
    ]);

    expect(first.id).toBe(second.id); // both calls resolved to the SAME row, neither threw
    expect(first.status).toBe('Active');

    const rows = await prisma.sharePointReviewDateMapping.findMany({
      where: { siteId: org.siteId, graphListId },
    });
    expect(rows).toHaveLength(1);
  });

  it('re-confirming an already-mapped library updates the existing row in place, not a second row', async () => {
    const context = createTenantContext(org.organizationId);
    const graphListId = 'list-reconfirm';

    const created = await context.sharePointReviewDateMappings.upsertActive(upsertInput(graphListId));
    const reconfirmed = await context.sharePointReviewDateMappings.upsertActive({
      ...upsertInput(graphListId),
      columnDefinitionId: 'col-2',
      columnDisplayNameAtConfirmation: 'Next Review',
    });

    expect(reconfirmed.id).toBe(created.id);
    expect(reconfirmed.columnDefinitionId).toBe('col-2');

    const rows = await prisma.sharePointReviewDateMapping.findMany({ where: { siteId: org.siteId, graphListId } });
    expect(rows).toHaveLength(1);
  });

  it('reactivates a Stale mapping on re-confirmation', async () => {
    const context = createTenantContext(org.organizationId);
    const graphListId = 'list-reactivate';

    const created = await context.sharePointReviewDateMappings.upsertActive(upsertInput(graphListId));
    await prisma.sharePointReviewDateMapping.update({
      where: { id: created.id },
      data: { status: 'Stale', staleDetectedAt: new Date() },
    });

    const reconfirmed = await context.sharePointReviewDateMappings.upsertActive(upsertInput(graphListId));

    expect(reconfirmed.status).toBe('Active');
    expect(reconfirmed.staleDetectedAt).toBeNull();
  });

  it('creates a second, independent mapping for a different library (different graphListId)', async () => {
    const context = createTenantContext(org.organizationId);

    const first = await context.sharePointReviewDateMappings.upsertActive(upsertInput('list-a'));
    const second = await context.sharePointReviewDateMappings.upsertActive(upsertInput('list-b'));

    expect(first.id).not.toBe(second.id);
  });

  it('scopes the created row to this organization, matching every other repository method', async () => {
    const context = createTenantContext(org.organizationId);

    const created = await context.sharePointReviewDateMappings.upsertActive(upsertInput('list-scoped'));

    const row = await prisma.sharePointReviewDateMapping.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.organizationId).toBe(org.organizationId);
  });

  describe('findManyBySite (Phase 2 — library list)', () => {
    it('returns an empty array when the site has no mappings', async () => {
      const context = createTenantContext(org.organizationId);

      const rows = await context.sharePointReviewDateMappings.findManyBySite(org.siteId);

      expect(rows).toEqual([]);
    });

    it('returns every mapping for the site in one query, not scoped to a single library', async () => {
      const context = createTenantContext(org.organizationId);
      await context.sharePointReviewDateMappings.upsertActive(upsertInput('list-x'));
      await context.sharePointReviewDateMappings.upsertActive(upsertInput('list-y'));

      const rows = await context.sharePointReviewDateMappings.findManyBySite(org.siteId);

      expect(rows.map((r) => r.graphListId).sort()).toEqual(['list-x', 'list-y']);
    });

    it('never returns a mapping belonging to a different site', async () => {
      const otherOrg = await seedOrg('other-site');
      const context = createTenantContext(org.organizationId);
      const otherContext = createTenantContext(otherOrg.organizationId);
      await context.sharePointReviewDateMappings.upsertActive(upsertInput('list-mine'));
      await otherContext.sharePointReviewDateMappings.upsertActive({
        siteId: otherOrg.siteId,
        graphListId: 'list-theirs',
        columnDefinitionId: 'col-1',
        columnDisplayNameAtConfirmation: 'Review Date',
        confirmedByUserId: otherOrg.userId,
      });

      const rows = await context.sharePointReviewDateMappings.findManyBySite(org.siteId);

      expect(rows.map((r) => r.graphListId)).toEqual(['list-mine']);
      await prisma.organization.delete({ where: { id: otherOrg.organizationId } });
    });
  });
});
