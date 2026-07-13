import { prisma } from '../client';
import { createTenantContext, type TenantContext } from '../index';

interface SeededOrg {
  organizationId: string;
  userId: string;
  microsoftTenantId: string;
  siteId: string;
  documentId: string;
  documentOwnerId: string;
  scanJobId: string;
  healthScoreId: string;
  healthIssueId: string;
  healthSnapshotId: string;
  scanScheduleId: string;
  governanceIssueId: string;
  governanceActivityId: string;
  context: TenantContext;
}

/**
 * Bootstraps a full, independent data tree for one organization, bypassing
 * the tenant context entirely (raw prisma.*.create calls) — this is the
 * one legitimate reason to touch the internal client directly from within
 * this package: seeding/teardown for isolation tests themselves.
 */
async function seedOrganization(label: string): Promise<SeededOrg> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const organization = await prisma.organization.create({
    data: { name: `Tenant Isolation Test Org ${unique}` },
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

  const document = await prisma.document.create({
    data: {
      organizationId: organization.id,
      siteId: site.id,
      graphItemId: `item-${unique}`,
      name: `Test Document ${unique}.docx`,
      path: `/sites/${unique}/Test Document.docx`,
      fileType: 'docx',
      sizeBytes: 1024,
      sourceCreatedAt: new Date(),
      sourceModifiedAt: new Date(),
    },
  });

  const documentOwner = await prisma.documentOwner.create({
    data: {
      documentId: document.id,
      organizationId: organization.id,
      ownerType: 'Author',
      displayName: `Test Author ${unique}`,
      email: `${unique}-author@example.com`,
      source: 'GraphMetadata',
    },
  });

  const scanJob = await prisma.scanJob.create({
    data: {
      organizationId: organization.id,
      microsoftTenantId: microsoftTenant.id,
      triggeredByUserId: user.id,
      status: 'Completed',
    },
  });

  const healthScore = await prisma.healthScore.create({
    data: {
      organizationId: organization.id,
      documentId: document.id,
      scanJobId: scanJob.id,
      compositeScore: 55,
      freshnessScore: 40,
      ownershipScore: 90,
      reviewStatusScore: 90,
      metadataScore: 90,
      duplicationScore: 90,
      ageScore: 40,
      healthBand: 'RequiresReview',
    },
  });

  const healthIssue = await prisma.healthIssue.create({
    data: {
      organizationId: organization.id,
      healthScoreId: healthScore.id,
      criterion: 'Freshness',
      severity: 'RequiresReview',
      message: 'Not modified in over 18 months.',
    },
  });

  const healthSnapshot = await prisma.healthSnapshot.create({
    data: {
      organizationId: organization.id,
      scanJobId: scanJob.id,
      totalDocumentsScanned: 1,
      averageHealthScore: 55,
      criticalIssuesCount: 1,
      warningIssuesCount: 0,
    },
  });

  const scanSchedule = await prisma.scanSchedule.create({
    data: {
      organizationId: organization.id,
      frequency: 'Daily',
      nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const governanceIssue = await prisma.governanceIssue.create({
    data: {
      organizationId: organization.id,
      documentId: document.id,
      issueType: 'Freshness',
      severity: 'RequiresReview',
    },
  });

  const governanceActivity = await prisma.governanceActivity.create({
    data: {
      organizationId: organization.id,
      governanceIssueId: governanceIssue.id,
      documentId: document.id,
      actorUserId: user.id,
      activityType: 'IssueCreated',
    },
  });

  return {
    organizationId: organization.id,
    userId: user.id,
    microsoftTenantId: microsoftTenant.id,
    siteId: site.id,
    documentId: document.id,
    documentOwnerId: documentOwner.id,
    scanJobId: scanJob.id,
    healthScoreId: healthScore.id,
    healthIssueId: healthIssue.id,
    healthSnapshotId: healthSnapshot.id,
    scanScheduleId: scanSchedule.id,
    governanceIssueId: governanceIssue.id,
    governanceActivityId: governanceActivity.id,
    context: createTenantContext(organization.id),
  };
}

describe('Cross-tenant data isolation (ADR-0001)', () => {
  let orgA: SeededOrg;
  let orgB: SeededOrg;

  beforeAll(async () => {
    orgA = await seedOrganization('org-a');
    orgB = await seedOrganization('org-b');
  }, 30_000);

  afterAll(async () => {
    // Organization cascade-delete removes every child row created above.
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.organizationId, orgB.organizationId] } } });
    await prisma.$disconnect();
  }, 30_000);

  describe('DocumentRepository (full CRUD isolation — representative deep case)', () => {
    it('findMany never includes another organization\'s document', async () => {
      const docs = await orgA.context.documents.findMany();
      expect(docs.some((d) => d.id === orgB.documentId)).toBe(false);
      expect(docs.some((d) => d.id === orgA.documentId)).toBe(true);
    });

    it('findFirstById returns null for another organization\'s document', async () => {
      const result = await orgA.context.documents.findFirstById(orgB.documentId);
      expect(result).toBeNull();
    });

    it('findFirstById returns the row for the owning organization', async () => {
      const result = await orgA.context.documents.findFirstById(orgA.documentId);
      expect(result?.id).toBe(orgA.documentId);
    });

    it('updateById is a no-op against another organization\'s document', async () => {
      const result = await orgA.context.documents.updateById(orgB.documentId, { name: 'hijacked.docx' });
      expect(result).toBeNull();

      const untouched = await orgB.context.documents.findFirstById(orgB.documentId);
      expect(untouched?.name).not.toBe('hijacked.docx');
    });

    it('deleteById is a no-op against another organization\'s document', async () => {
      const deleted = await orgA.context.documents.deleteById(orgB.documentId);
      expect(deleted).toBe(false);

      const stillExists = await orgB.context.documents.findFirstById(orgB.documentId);
      expect(stillExists).not.toBeNull();
    });

    it('create always writes under the bound organizationId, regardless of caller input', async () => {
      const created = await orgA.context.documents.create({
        siteId: orgA.siteId,
        graphItemId: `extra-${Date.now()}`,
        name: 'extra.docx',
        path: '/extra.docx',
        fileType: 'docx',
        sizeBytes: 512,
        sourceCreatedAt: new Date(),
        sourceModifiedAt: new Date(),
      });
      expect(created.organizationId).toBe(orgA.organizationId);
    });
  });

  describe('Remaining repositories — findMany/findFirstById isolation sweep', () => {
    it('UserRepository never leaks across organizations', async () => {
      const list = await orgA.context.users.findMany();
      expect(list.some((u) => u.id === orgB.userId)).toBe(false);
      expect(await orgA.context.users.findFirstById(orgB.userId)).toBeNull();
    });

    it('MicrosoftTenantRepository never leaks across organizations', async () => {
      const list = await orgA.context.microsoftTenants.findMany();
      expect(list.some((t) => t.id === orgB.microsoftTenantId)).toBe(false);
      expect(await orgA.context.microsoftTenants.findFirstById(orgB.microsoftTenantId)).toBeNull();
    });

    it('SharePointSiteRepository never leaks across organizations', async () => {
      const list = await orgA.context.sharePointSites.findMany();
      expect(list.some((s) => s.id === orgB.siteId)).toBe(false);
      expect(await orgA.context.sharePointSites.findFirstById(orgB.siteId)).toBeNull();
    });

    it('DocumentOwnerRepository never leaks across organizations', async () => {
      const list = await orgA.context.documentOwners.findMany();
      expect(list.some((o) => o.id === orgB.documentOwnerId)).toBe(false);
      expect(await orgA.context.documentOwners.findFirstById(orgB.documentOwnerId)).toBeNull();
    });

    it('ScanJobRepository never leaks across organizations', async () => {
      const list = await orgA.context.scanJobs.findMany();
      expect(list.some((s) => s.id === orgB.scanJobId)).toBe(false);
      expect(await orgA.context.scanJobs.findFirstById(orgB.scanJobId)).toBeNull();
    });

    it('HealthScoreRepository never leaks across organizations', async () => {
      const list = await orgA.context.healthScores.findMany();
      expect(list.some((h) => h.id === orgB.healthScoreId)).toBe(false);
      expect(await orgA.context.healthScores.findFirstById(orgB.healthScoreId)).toBeNull();
    });

    it('HealthIssueRepository never leaks across organizations', async () => {
      const list = await orgA.context.healthIssues.findMany();
      expect(list.some((h) => h.id === orgB.healthIssueId)).toBe(false);
      expect(await orgA.context.healthIssues.findFirstById(orgB.healthIssueId)).toBeNull();
    });

    it('HealthSnapshotRepository never leaks across organizations', async () => {
      const list = await orgA.context.healthSnapshots.findMany();
      expect(list.some((s) => s.id === orgB.healthSnapshotId)).toBe(false);
      expect(await orgA.context.healthSnapshots.findFirstById(orgB.healthSnapshotId)).toBeNull();
    });

    it('ScanScheduleRepository never leaks across organizations', async () => {
      const list = await orgA.context.scanSchedules.findMany();
      expect(list.some((s) => s.id === orgB.scanScheduleId)).toBe(false);
      expect(await orgA.context.scanSchedules.findFirstById(orgB.scanScheduleId)).toBeNull();
    });

    it('GovernanceIssueRepository never leaks across organizations', async () => {
      const list = await orgA.context.governanceIssues.findMany();
      expect(list.some((g) => g.id === orgB.governanceIssueId)).toBe(false);
      expect(await orgA.context.governanceIssues.findFirstById(orgB.governanceIssueId)).toBeNull();
    });

    it('GovernanceActivityRepository never leaks across organizations', async () => {
      const list = await orgA.context.governanceActivity.findMany();
      expect(list.some((a) => a.id === orgB.governanceActivityId)).toBe(false);
      expect(await orgA.context.governanceActivity.findFirstById(orgB.governanceActivityId)).toBeNull();
    });
  });

  describe('GovernanceActivityRepository — append-only (Phase 8C)', () => {
    it('has no updateById or deleteById method — immutability is enforced by the repository shape itself', () => {
      const repo = orgA.context.governanceActivity as unknown as { updateById?: unknown; deleteById?: unknown };
      expect(repo.updateById).toBeUndefined();
      expect(repo.deleteById).toBeUndefined();
    });
  });

  describe('OrganizationRepository', () => {
    it('get() only ever returns the bound organization, never another one', async () => {
      const own = await orgA.context.organization.get();
      expect(own?.id).toBe(orgA.organizationId);
      expect(own?.id).not.toBe(orgB.organizationId);
    });

    it('has no create() method — organization creation is a bootstrap operation outside tenant scope', () => {
      expect((orgA.context.organization as unknown as { create?: unknown }).create).toBeUndefined();
    });
  });
});
