import { prisma } from './client';
import { createRemediationJobWithItems } from './remediation';
import { createTenantContext } from './tenant-context';

interface SeededOrg {
  organizationId: string;
  userId: string;
  siteId: string;
  documentIds: string[];
}

/**
 * Mirrors tenant-isolation.spec.ts / sharepoint-review-date-mapping-repository.spec.ts's
 * seeding precedent — a real, independent data tree via raw prisma calls,
 * trimmed to only what RemediationJob/RemediationItem's FKs require.
 */
async function seedOrg(label: string, documentCount = 2): Promise<SeededOrg> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const organization = await prisma.organization.create({
    data: { name: `Remediation Test Org ${unique}` },
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

  return { organizationId: organization.id, userId: user.id, siteId: site.id, documentIds };
}

function jobInput(org: SeededOrg, documentIds: string[] = org.documentIds) {
  return {
    organizationId: org.organizationId,
    issueType: 'ReviewStatus' as const,
    payload: { nextReviewDueAt: '2026-12-01T00:00:00.000Z' },
    initiatedByUserId: org.userId,
    initiatedByRole: 'Admin' as const,
    documentIds,
  };
}

describe('createRemediationJobWithItems (ADR-0022 §8 — atomic job + item creation)', () => {
  let org: SeededOrg;

  beforeEach(async () => {
    org = await seedOrg('create', 2);
  }, 30_000);

  afterEach(async () => {
    await prisma.organization.delete({ where: { id: org.organizationId } });
  }, 30_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates exactly one RemediationJob with the expected fields', async () => {
    const result = await createRemediationJobWithItems(jobInput(org));

    expect(result.organizationId).toBe(org.organizationId);
    expect(result.issueType).toBe('ReviewStatus');
    expect(result.status).toBe('Running');
    expect(result.initiatedByUserId).toBe(org.userId);
    expect(result.initiatedByRole).toBe('Admin');
    expect(result.totalCount).toBe(2);
    expect(result.succeededCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.payload).toEqual({ nextReviewDueAt: '2026-12-01T00:00:00.000Z' });
    expect(result.completedAt).toBeNull();
  });

  it('creates one RemediationItem per document, each Pending', async () => {
    const result = await createRemediationJobWithItems(jobInput(org));

    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) => item.status === 'Pending')).toBe(true);
    expect(result.items.map((item) => item.documentId).sort()).toEqual([...org.documentIds].sort());
  });

  it('the job → items relationship is queryable both ways (RemediationJob.items and RemediationItem.remediationJobId)', async () => {
    const result = await createRemediationJobWithItems(jobInput(org));

    const jobWithItems = await prisma.remediationJob.findUniqueOrThrow({
      where: { id: result.id },
      include: { items: true },
    });
    expect(jobWithItems.items).toHaveLength(2);
    expect(jobWithItems.items.every((item) => item.remediationJobId === result.id)).toBe(true);
  });

  it('every created RemediationItem carries the same organizationId as the job (ADR-0022 §13.1)', async () => {
    const result = await createRemediationJobWithItems(jobInput(org));

    expect(result.items.every((item) => item.organizationId === org.organizationId)).toBe(true);
  });

  it('rejects if the same document appears twice in one job — the unique (remediationJobId, documentId) constraint', async () => {
    const [duplicateDocumentId] = org.documentIds;

    await expect(
      createRemediationJobWithItems(jobInput(org, [duplicateDocumentId!, duplicateDocumentId!])),
    ).rejects.toThrow();

    // Nothing partially committed — the transaction rolled back entirely.
    const jobs = await prisma.remediationJob.findMany({ where: { organizationId: org.organizationId } });
    expect(jobs).toHaveLength(0);
  });

  it('two separate jobs can each target the same document independently (no cross-job uniqueness — ADR-0022 §13.5)', async () => {
    const [documentId] = org.documentIds;

    const first = await createRemediationJobWithItems(jobInput(org, [documentId!]));
    const second = await createRemediationJobWithItems(jobInput(org, [documentId!]));

    expect(first.id).not.toBe(second.id);
    expect(first.items[0]?.documentId).toBe(documentId);
    expect(second.items[0]?.documentId).toBe(documentId);
  });
});

describe('RemediationItem status queries (ADR-0022 §3.3 — Postgres as the resume source of truth)', () => {
  let org: SeededOrg;

  beforeEach(async () => {
    org = await seedOrg('status-query', 3);
  }, 30_000);

  afterEach(async () => {
    await prisma.organization.delete({ where: { id: org.organizationId } });
  }, 30_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('finding Pending items for a job returns only the ones still Pending, not terminal ones', async () => {
    const context = createTenantContext(org.organizationId);
    const created = await createRemediationJobWithItems(jobInput(org));
    const [firstItem, secondItem] = created.items;

    await context.remediationItems.updateById(firstItem!.id, { status: 'Succeeded' });
    await context.remediationItems.updateById(secondItem!.id, { status: 'Failed', errorType: 'GraphPermissionError' });

    const pending = await context.remediationItems.findMany({
      where: { remediationJobId: created.id, status: 'Pending' },
    });

    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).not.toBe(firstItem!.id);
    expect(pending[0]?.id).not.toBe(secondItem!.id);
  });

  it('a Succeeded item remains distinguishable from a Pending one after an update — resume logic can skip it', async () => {
    const context = createTenantContext(org.organizationId);
    const created = await createRemediationJobWithItems(jobInput(org));
    const [firstItem] = created.items;

    const updated = await context.remediationItems.updateById(firstItem!.id, { status: 'Succeeded' });

    expect(updated?.status).toBe('Succeeded');
    const stillThere = await context.remediationItems.findFirstById(firstItem!.id);
    expect(stillThere?.status).toBe('Succeeded');
  });

  it('a write that succeeds but fails verification stays Pending — never Failed, never Succeeded (ADR-0022 §13.3)', async () => {
    const context = createTenantContext(org.organizationId);
    const created = await createRemediationJobWithItems(jobInput(org));
    const [firstItem] = created.items;

    // Simulates the ambiguous-mismatch case: the PATCH succeeded but the
    // targeted re-fetch didn't confirm the value — attemptCount advances,
    // status stays at its Pending default, no errorType is set.
    const afterAttempt = await context.remediationItems.updateById(firstItem!.id, { attemptCount: 1 });

    expect(afterAttempt?.status).toBe('Pending');
    expect(afterAttempt?.errorType).toBeNull();
  });

  it('errorType/errorMessage are preserved on a Failed item for later inspection', async () => {
    const context = createTenantContext(org.organizationId);
    const created = await createRemediationJobWithItems(jobInput(org));
    const [firstItem] = created.items;

    const failed = await context.remediationItems.updateById(firstItem!.id, {
      status: 'Failed',
      errorType: 'GraphNotFoundError',
      errorMessage: 'The item was not found',
    });

    expect(failed?.status).toBe('Failed');
    expect(failed?.errorType).toBe('GraphNotFoundError');
    expect(failed?.errorMessage).toBe('The item was not found');
  });
});

describe('RemediationJob/RemediationItem schema compatibility (migration sanity check)', () => {
  let org: SeededOrg;

  beforeEach(async () => {
    org = await seedOrg('schema-check', 1);
  }, 30_000);

  afterEach(async () => {
    await prisma.organization.delete({ where: { id: org.organizationId } });
  }, 30_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('RemediationJob defaults status to Running and RemediationItem defaults status to Pending without the caller specifying either', async () => {
    const context = createTenantContext(org.organizationId);

    const job = await context.remediationJobs.create({
      issueType: 'ReviewStatus',
      payload: { nextReviewDueAt: '2026-12-01T00:00:00.000Z' } as object,
      initiatedByUserId: org.userId,
      initiatedByRole: 'Admin',
      totalCount: 1,
    });
    const item = await context.remediationItems.create({
      remediationJobId: job.id,
      documentId: org.documentIds[0]!,
    });

    expect(job.status).toBe('Running');
    expect(item.status).toBe('Pending');
    expect(item.attemptCount).toBe(0);
    expect(item.errorType).toBeNull();
    expect(item.updatedAt).toBeInstanceOf(Date);
    expect(job.createdAt).toBeInstanceOf(Date);
  });

  it('deleting the parent RemediationJob cascades to its RemediationItems', async () => {
    const created = await createRemediationJobWithItems(jobInput(org, [org.documentIds[0]!]));

    await prisma.remediationJob.delete({ where: { id: created.id } });

    const remainingItems = await prisma.remediationItem.findMany({ where: { remediationJobId: created.id } });
    expect(remainingItems).toHaveLength(0);
  });

  it('deleting the target Document cascades to its RemediationItems', async () => {
    const created = await createRemediationJobWithItems(jobInput(org, [org.documentIds[0]!]));

    await prisma.document.delete({ where: { id: org.documentIds[0]! } });

    const remainingItems = await prisma.remediationItem.findMany({ where: { remediationJobId: created.id } });
    expect(remainingItems).toHaveLength(0);
  });
});
