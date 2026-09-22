import { prisma } from './client';
import { createTenantContext } from './tenant-context';
import { tryConsumeDocumentSlot, releaseDocumentSlot, NoEntitlementError } from './entitlement';

interface SeededOrg {
  organizationId: string;
  siteId: string;
}

/**
 * Mirrors document-owner-repository.spec.ts's/tenant-isolation.spec.ts's
 * seedOrg precedent — a real, independent data tree via raw prisma calls.
 * `documentLimit`/`currentDocumentCount` are set directly (bypassing
 * onboarding.ts's provisionOrganizationFromConsent, which always starts at
 * 0) so each test can start an organization at whatever usage level the
 * scenario needs — e.g. "one remaining slot" — without first consuming
 * hundreds of real slots to get there.
 */
async function seedOrg(label: string, documentLimit: number, currentDocumentCount = 0): Promise<SeededOrg> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const organization = await prisma.organization.create({
    data: { name: `Entitlement Test Org ${unique}` },
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

describe('Entitlement / usage foundation', () => {
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

  describe('OrganizationEntitlementRepository (plain CRUD, tenant-scoped)', () => {
    it('get() returns the entitlement for the bound organization', async () => {
      const org = await seedOrg('repo-get', 2000, 5);
      createdOrgIds.push(org.organizationId);

      const entitlement = await createTenantContext(org.organizationId).entitlement.get();
      expect(entitlement?.organizationId).toBe(org.organizationId);
      expect(entitlement?.planType).toBe('Trial');
      expect(entitlement?.documentLimit).toBe(2000);
      expect(entitlement?.currentDocumentCount).toBe(5);
    });

    it('get() never resolves another organization\'s entitlement', async () => {
      const orgA = await seedOrg('repo-isolation-a', 2000, 0);
      const orgB = await seedOrg('repo-isolation-b', 2000, 999);
      createdOrgIds.push(orgA.organizationId, orgB.organizationId);

      const entitlementA = await createTenantContext(orgA.organizationId).entitlement.get();
      expect(entitlementA?.currentDocumentCount).toBe(0);
      expect(entitlementA?.organizationId).not.toBe(orgB.organizationId);
    });
  });

  describe('1. Trial organization below 2,000 documents', () => {
    it('consumes a slot and reports success with the incremented count', async () => {
      const org = await seedOrg('below-limit', 2000, 1500);
      createdOrgIds.push(org.organizationId);

      const result = await tryConsumeDocumentSlot(org.organizationId);

      expect(result).toEqual({ success: true, currentDocumentCount: 1501, documentLimit: 2000 });
      expect((await getEntitlement(org.organizationId)).currentDocumentCount).toBe(1501);
    });
  });

  describe('2. Trial organization exactly at 2,000', () => {
    it('rejects the consume attempt and leaves the counter unchanged', async () => {
      const org = await seedOrg('at-limit', 2000, 2000);
      createdOrgIds.push(org.organizationId);

      const result = await tryConsumeDocumentSlot(org.organizationId);

      expect(result).toEqual({ success: false, currentDocumentCount: 2000, documentLimit: 2000 });
      expect((await getEntitlement(org.organizationId)).currentDocumentCount).toBe(2000);
    });
  });

  describe('3. Organization with one remaining slot', () => {
    it('the single consume attempt succeeds and lands exactly at the limit', async () => {
      const org = await seedOrg('one-remaining', 2000, 1999);
      createdOrgIds.push(org.organizationId);

      const result = await tryConsumeDocumentSlot(org.organizationId);

      expect(result).toEqual({ success: true, currentDocumentCount: 2000, documentLimit: 2000 });

      // The very next attempt, now genuinely at the limit, must fail.
      const next = await tryConsumeDocumentSlot(org.organizationId);
      expect(next.success).toBe(false);
      expect(next.currentDocumentCount).toBe(2000);
    });
  });

  describe('4. Existing document update does not consume a slot', () => {
    it('rescanning (updating) an already-persisted document never touches the counter', async () => {
      const org = await seedOrg('rescan-no-consume', 2000, 10);
      createdOrgIds.push(org.organizationId);
      const context = createTenantContext(org.organizationId);

      // A genuinely new document: the future worker integration's
      // contract is "consume a slot only for the create branch" — this
      // test proves the counter and Document creation are independent
      // operations today (no implicit coupling exists that would make an
      // ordinary Document.create silently affect usage), which is exactly
      // what makes it safe for a future caller to gate only the create
      // branch, never the update branch, without the counter model
      // itself needing to know the difference.
      const document = await context.documents.create({
        siteId: org.siteId,
        graphItemId: 'item-1',
        name: 'Handbook.docx',
        path: '/Handbook.docx',
        fileType: 'docx',
        sizeBytes: 1024,
        sourceCreatedAt: new Date(),
        sourceModifiedAt: new Date(),
      });
      expect((await getEntitlement(org.organizationId)).currentDocumentCount).toBe(10);

      // Rescanning it (the upsert's update branch, per
      // document-collector.processor.ts's upsertDocument) — still no
      // change to usage.
      await context.documents.updateById(document.id, { name: 'Handbook (v2).docx' });
      expect((await getEntitlement(org.organizationId)).currentDocumentCount).toBe(10);
    });
  });

  describe('5. Separate organizations cannot affect each other\'s usage', () => {
    it('consuming a slot for one organization never changes another\'s counter', async () => {
      const orgA = await seedOrg('cross-org-a', 2000, 1999);
      const orgB = await seedOrg('cross-org-b', 2000, 1999);
      createdOrgIds.push(orgA.organizationId, orgB.organizationId);

      await tryConsumeDocumentSlot(orgA.organizationId);

      expect((await getEntitlement(orgA.organizationId)).currentDocumentCount).toBe(2000);
      expect((await getEntitlement(orgB.organizationId)).currentDocumentCount).toBe(1999);
    });

    it('one organization reaching its limit never blocks another organization\'s consume attempt', async () => {
      const orgA = await seedOrg('cross-org-exhausted', 5, 5);
      const orgB = await seedOrg('cross-org-fresh', 2000, 0);
      createdOrgIds.push(orgA.organizationId, orgB.organizationId);

      const resultA = await tryConsumeDocumentSlot(orgA.organizationId);
      const resultB = await tryConsumeDocumentSlot(orgB.organizationId);

      expect(resultA.success).toBe(false);
      expect(resultB).toEqual({ success: true, currentDocumentCount: 1, documentLimit: 2000 });
    });
  });

  describe('6 & 7. Concurrent attempts to consume the final available slot — the limit cannot be exceeded', () => {
    it('exactly one of many concurrent callers racing for the last slot succeeds', async () => {
      const org = await seedOrg('concurrent-last-slot', 2000, 1999);
      createdOrgIds.push(org.organizationId);

      // 10 genuinely concurrent callers (no `client` passed, so each opens
      // its own connection from the shared pool and issues its UPDATE
      // independently) racing for the single remaining slot — the exact
      // scenario the architecture evaluation identified as unsafe under a
      // naive count-then-compare-then-write implementation.
      const attempts = await Promise.all(Array.from({ length: 10 }, () => tryConsumeDocumentSlot(org.organizationId)));

      const successes = attempts.filter((result) => result.success);
      const failures = attempts.filter((result) => !result.success);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(9);

      // The limit was never exceeded — not 2001, not 2009 from 9 lost
      // updates silently applying anyway.
      const finalEntitlement = await getEntitlement(org.organizationId);
      expect(finalEntitlement.currentDocumentCount).toBe(2000);
    });

    it('under heavier concurrency (50 callers, 5 slots), successes exactly match available slots and the counter never overshoots the limit', async () => {
      const org = await seedOrg('concurrent-stress', 2005, 2000);
      createdOrgIds.push(org.organizationId);

      const attempts = await Promise.all(Array.from({ length: 50 }, () => tryConsumeDocumentSlot(org.organizationId)));

      const successes = attempts.filter((result) => result.success);
      expect(successes).toHaveLength(5);

      const finalEntitlement = await getEntitlement(org.organizationId);
      expect(finalEntitlement.currentDocumentCount).toBe(2005);
      expect(finalEntitlement.currentDocumentCount).toBeLessThanOrEqual(finalEntitlement.documentLimit);
    });
  });

  describe('8. Counter consistency when the document-creation transaction fails', () => {
    it('rolls back the slot reservation together with a failed Document creation in the same transaction', async () => {
      const org = await seedOrg('transactional-rollback', 2000, 100);
      createdOrgIds.push(org.organizationId);

      // A document already occupying a given (siteId, graphItemId) — the
      // real @@unique constraint document-collector.processor.ts's
      // upsertDocument relies on. Used below to force the "create" half
      // of a combined reserve-then-create transaction to fail.
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

      // This is the shape a future worker integration would use: consume
      // the slot and create the Document inside the SAME transaction, by
      // passing the transaction's own `tx` client into
      // tryConsumeDocumentSlot rather than letting it open its own.
      await expect(
        prisma.$transaction(async (tx) => {
          const reserved = await tryConsumeDocumentSlot(org.organizationId, tx);
          expect(reserved.success).toBe(true); // the reservation itself succeeds...

          // ...but creating the Document violates @@unique([siteId, graphItemId]).
          await tx.document.create({
            data: {
              organizationId: org.organizationId,
              siteId: org.siteId,
              graphItemId: 'duplicate-item',
              name: 'Colliding.docx',
              path: '/Colliding.docx',
              fileType: 'docx',
              sizeBytes: 1,
              sourceCreatedAt: new Date(),
              sourceModifiedAt: new Date(),
            },
          });
        }),
      ).rejects.toThrow();

      // The whole transaction rolled back — the counter must show the
      // ORIGINAL value, not 101. A reservation that "succeeded" while the
      // Document it was for never actually got created would otherwise
      // permanently and silently under-count real remaining capacity.
      const finalEntitlement = await getEntitlement(org.organizationId);
      expect(finalEntitlement.currentDocumentCount).toBe(100);
    });

    it('commits the slot reservation together with a successful Document creation in the same transaction', async () => {
      const org = await seedOrg('transactional-commit', 2000, 100);
      createdOrgIds.push(org.organizationId);

      await prisma.$transaction(async (tx) => {
        const reserved = await tryConsumeDocumentSlot(org.organizationId, tx);
        expect(reserved.success).toBe(true);

        await tx.document.create({
          data: {
            organizationId: org.organizationId,
            siteId: org.siteId,
            graphItemId: 'new-item',
            name: 'New.docx',
            path: '/New.docx',
            fileType: 'docx',
            sizeBytes: 1,
            sourceCreatedAt: new Date(),
            sourceModifiedAt: new Date(),
          },
        });
      });

      expect((await getEntitlement(org.organizationId)).currentDocumentCount).toBe(101);
    });
  });

  describe('releaseDocumentSlot', () => {
    it('decrements the counter by one', async () => {
      const org = await seedOrg('release-basic', 2000, 10);
      createdOrgIds.push(org.organizationId);

      const result = await releaseDocumentSlot(org.organizationId);

      expect(result).toEqual({ success: true, currentDocumentCount: 9, documentLimit: 2000 });
    });

    it('never goes below zero, even if called more times than slots were consumed', async () => {
      const org = await seedOrg('release-floor', 2000, 1);
      createdOrgIds.push(org.organizationId);

      await releaseDocumentSlot(org.organizationId);
      const secondRelease = await releaseDocumentSlot(org.organizationId);

      expect(secondRelease.currentDocumentCount).toBe(0);
    });

    it('freeing a slot makes room for a subsequent consume at a previously-exhausted limit', async () => {
      const org = await seedOrg('release-then-consume', 100, 100);
      createdOrgIds.push(org.organizationId);

      const blocked = await tryConsumeDocumentSlot(org.organizationId);
      expect(blocked.success).toBe(false);

      await releaseDocumentSlot(org.organizationId);

      const allowed = await tryConsumeDocumentSlot(org.organizationId);
      expect(allowed).toEqual({ success: true, currentDocumentCount: 100, documentLimit: 100 });
    });
  });

  describe('Fail-closed behavior when no entitlement row exists', () => {
    it('tryConsumeDocumentSlot throws NoEntitlementError rather than silently allowing an unlimited document', async () => {
      // A bare Organization with no entitlement at all — the state this
      // migration's backfill/bootstrap wiring is specifically designed to
      // make unreachable in practice, exercised directly here.
      const organization = await prisma.organization.create({ data: { name: `No-entitlement Test Org ${Date.now()}` } });
      createdOrgIds.push(organization.id);

      await expect(tryConsumeDocumentSlot(organization.id)).rejects.toThrow(NoEntitlementError);
    });

    it('releaseDocumentSlot throws NoEntitlementError under the same condition', async () => {
      const organization = await prisma.organization.create({ data: { name: `No-entitlement Test Org ${Date.now()}` } });
      createdOrgIds.push(organization.id);

      await expect(releaseDocumentSlot(organization.id)).rejects.toThrow(NoEntitlementError);
    });
  });
});
