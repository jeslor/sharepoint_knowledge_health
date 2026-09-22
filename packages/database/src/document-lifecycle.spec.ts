import { prisma } from './client';
import { createDocumentWithQuota, markDocumentRemovedAndReleaseSlot, type CreateDocumentWithQuotaInput } from './document-lifecycle';

interface SeededOrg {
  organizationId: string;
  siteId: string;
}

/**
 * Mirrors entitlement.spec.ts's own seedOrg precedent exactly — a real,
 * independent data tree via raw prisma calls, with documentLimit/
 * currentDocumentCount set directly so each test can start at whatever
 * usage level the scenario needs.
 */
async function seedOrg(label: string, documentLimit: number, currentDocumentCount = 0): Promise<SeededOrg> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const organization = await prisma.organization.create({
    data: { name: `Document Lifecycle Test Org ${unique}` },
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

  await prisma.organizationEntitlement.create({
    data: { organizationId: organization.id, planType: 'Trial', documentLimit, currentDocumentCount },
  });

  return { organizationId: organization.id, siteId: site.id };
}

async function getEntitlement(organizationId: string) {
  const entitlement = await prisma.organizationEntitlement.findUnique({ where: { organizationId } });
  if (!entitlement) throw new Error(`Expected an entitlement for ${organizationId}`);
  return entitlement;
}

function documentInput(org: SeededOrg, graphItemId: string): CreateDocumentWithQuotaInput {
  return {
    organizationId: org.organizationId,
    siteId: org.siteId,
    graphItemId,
    name: `${graphItemId}.docx`,
    path: `/${graphItemId}.docx`,
    fileType: 'docx',
    webUrl: null,
    sizeBytes: BigInt(1),
    sourceCreatedAt: new Date(),
    sourceModifiedAt: new Date(),
  };
}

describe('Document lifecycle (Phase 3: worker-side authoritative trial quota enforcement)', () => {
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

  describe('createDocumentWithQuota', () => {
    it('creates an Active Document and consumes exactly one slot when the organization is below its limit', async () => {
      const org = await seedOrg('create-below-limit', 2000, 100);
      createdOrgIds.push(org.organizationId);

      const result = await createDocumentWithQuota(documentInput(org, 'item-1'));

      expect(result.outcome).toBe('created');
      if (result.outcome !== 'created') throw new Error('expected created');
      expect(result.document.status).toBe('Active');
      expect(result.document.graphItemId).toBe('item-1');
      expect((await getEntitlement(org.organizationId)).currentDocumentCount).toBe(101);
    });

    it('does not create a Document, and leaves the counter unchanged, when the organization is exactly at its limit', async () => {
      const org = await seedOrg('create-at-limit', 2000, 2000);
      createdOrgIds.push(org.organizationId);

      const result = await createDocumentWithQuota(documentInput(org, 'item-1'));

      expect(result.outcome).toBe('limitReached');
      if (result.outcome !== 'limitReached') throw new Error('expected limitReached');
      expect(result.currentDocumentCount).toBe(2000);
      expect(result.documentLimit).toBe(2000);

      const persisted = await prisma.document.findFirst({ where: { organizationId: org.organizationId, graphItemId: 'item-1' } });
      expect(persisted).toBeNull();
      expect((await getEntitlement(org.organizationId)).currentDocumentCount).toBe(2000);
    });

    it('with exactly one remaining slot, the single new document is created and lands exactly at the limit', async () => {
      const org = await seedOrg('create-one-remaining', 2000, 1999);
      createdOrgIds.push(org.organizationId);

      const result = await createDocumentWithQuota(documentInput(org, 'item-1'));

      expect(result.outcome).toBe('created');
      expect((await getEntitlement(org.organizationId)).currentDocumentCount).toBe(2000);

      // The limit is now genuinely exhausted for a subsequent attempt.
      const next = await createDocumentWithQuota(documentInput(org, 'item-2'));
      expect(next.outcome).toBe('limitReached');
    });

    it('under real concurrent workers competing for the final slot, exactly one createDocumentWithQuota call succeeds', async () => {
      const org = await seedOrg('create-concurrent-last-slot', 2000, 1999);
      createdOrgIds.push(org.organizationId);

      // 10 genuinely concurrent callers (no shared transaction/client), each
      // for a distinct graphItemId — simulates multiple worker replicas
      // discovering different new documents for the same organization at
      // the same instant (concurrency config: worker/queue.module.ts).
      const attempts = await Promise.all(
        Array.from({ length: 10 }, (_unused, i) => createDocumentWithQuota(documentInput(org, `item-concurrent-${i}`))),
      );

      const created = attempts.filter((a) => a.outcome === 'created');
      const limitReached = attempts.filter((a) => a.outcome === 'limitReached');
      expect(created).toHaveLength(1);
      expect(limitReached).toHaveLength(9);
      expect((await getEntitlement(org.organizationId)).currentDocumentCount).toBe(2000);

      const persistedCount = await prisma.document.count({ where: { organizationId: org.organizationId, status: 'Active' } });
      expect(persistedCount).toBe(1);
    });

    it('rolls back the slot reservation together with a Document creation failure in the same transaction', async () => {
      const org = await seedOrg('create-rollback-on-failure', 2000, 100);
      createdOrgIds.push(org.organizationId);

      // A document already occupying this (siteId, graphItemId) — forces
      // the create half of createDocumentWithQuota's single transaction to
      // violate @@unique([siteId, graphItemId]).
      await prisma.document.create({
        data: {
          organizationId: org.organizationId,
          siteId: org.siteId,
          graphItemId: 'duplicate-item',
          name: 'Original.docx',
          path: '/Original.docx',
          fileType: 'docx',
          sizeBytes: 1,
          sourceCreatedAt: new Date(),
          sourceModifiedAt: new Date(),
        },
      });

      await expect(createDocumentWithQuota(documentInput(org, 'duplicate-item'))).rejects.toThrow();

      // The reservation must not have been left committed — a "successful"
      // slot consumption for a Document that doesn't exist would otherwise
      // permanently and silently under-count real remaining capacity.
      expect((await getEntitlement(org.organizationId)).currentDocumentCount).toBe(100);
    });

    it('never affects another organization\'s counter or documents', async () => {
      const orgA = await seedOrg('create-isolation-a', 2000, 100);
      const orgB = await seedOrg('create-isolation-b', 2000, 200);
      createdOrgIds.push(orgA.organizationId, orgB.organizationId);

      await createDocumentWithQuota(documentInput(orgA, 'item-1'));

      expect((await getEntitlement(orgA.organizationId)).currentDocumentCount).toBe(101);
      expect((await getEntitlement(orgB.organizationId)).currentDocumentCount).toBe(200);
      const orgBDocs = await prisma.document.count({ where: { organizationId: orgB.organizationId } });
      expect(orgBDocs).toBe(0);
    });
  });

  describe('markDocumentRemovedAndReleaseSlot', () => {
    async function seedActiveDocument(org: SeededOrg, graphItemId: string) {
      return prisma.document.create({
        data: {
          organizationId: org.organizationId,
          siteId: org.siteId,
          graphItemId,
          name: `${graphItemId}.docx`,
          path: `/${graphItemId}.docx`,
          fileType: 'docx',
          sizeBytes: 1,
          sourceCreatedAt: new Date(),
          sourceModifiedAt: new Date(),
          status: 'Active',
        },
      });
    }

    it('transitions Active -> Removed and decrements the counter exactly once', async () => {
      const org = await seedOrg('remove-basic', 2000, 100);
      createdOrgIds.push(org.organizationId);
      const document = await seedActiveDocument(org, 'item-1');

      const result = await markDocumentRemovedAndReleaseSlot(org.organizationId, document.id);

      expect(result?.released).toBe(true);
      expect(result?.document.status).toBe('Removed');
      expect((await getEntitlement(org.organizationId)).currentDocumentCount).toBe(99);
    });

    it('does not release an additional slot when the document is already Removed', async () => {
      const org = await seedOrg('remove-already-removed', 2000, 100);
      createdOrgIds.push(org.organizationId);
      const document = await seedActiveDocument(org, 'item-1');

      const first = await markDocumentRemovedAndReleaseSlot(org.organizationId, document.id);
      const second = await markDocumentRemovedAndReleaseSlot(org.organizationId, document.id);

      expect(first?.released).toBe(true);
      expect(second?.released).toBe(false);
      expect(second?.document.status).toBe('Removed');
      expect((await getEntitlement(org.organizationId)).currentDocumentCount).toBe(99);
    });

    it('never releases another organization\'s slot when called with a mismatched organizationId — returns null (not found under that tenant scope), never throws', async () => {
      const owner = await seedOrg('remove-cross-org-owner', 2000, 100);
      const attacker = await seedOrg('remove-cross-org-attacker', 2000, 50);
      createdOrgIds.push(owner.organizationId, attacker.organizationId);
      const document = await seedActiveDocument(owner, 'item-1');

      const result = await markDocumentRemovedAndReleaseSlot(attacker.organizationId, document.id);

      expect(result).toBeNull();
      // Neither organization's counter moved, and the document is untouched.
      expect((await getEntitlement(owner.organizationId)).currentDocumentCount).toBe(100);
      expect((await getEntitlement(attacker.organizationId)).currentDocumentCount).toBe(50);
      const untouched = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
      expect(untouched.status).toBe('Active');
    });

    it('never drives the counter negative, even if somehow invoked more times than slots were consumed', async () => {
      const org = await seedOrg('remove-floor', 2000, 0);
      createdOrgIds.push(org.organizationId);
      const document = await seedActiveDocument(org, 'item-1');
      // Force currentDocumentCount to 0 despite one Active document existing
      // (an inconsistent state that should never occur via the supported
      // paths, but the release primitive itself must still be safe).
      await prisma.organizationEntitlement.update({ where: { organizationId: org.organizationId }, data: { currentDocumentCount: 0 } });

      const result = await markDocumentRemovedAndReleaseSlot(org.organizationId, document.id);

      expect(result?.released).toBe(true);
      expect((await getEntitlement(org.organizationId)).currentDocumentCount).toBe(0);
    });

    it('releasing a slot makes room for a subsequent createDocumentWithQuota call at a previously-exhausted limit', async () => {
      const org = await seedOrg('remove-then-create', 100, 100);
      createdOrgIds.push(org.organizationId);
      const document = await seedActiveDocument(org, 'item-old');

      const blocked = await createDocumentWithQuota(documentInput(org, 'item-new'));
      expect(blocked.outcome).toBe('limitReached');

      await markDocumentRemovedAndReleaseSlot(org.organizationId, document.id);

      const allowed = await createDocumentWithQuota(documentInput(org, 'item-new'));
      expect(allowed.outcome).toBe('created');
      expect((await getEntitlement(org.organizationId)).currentDocumentCount).toBe(100);
    });
  });
});
