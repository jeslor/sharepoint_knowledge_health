import { prisma } from '../client';
import { createTenantContext } from '../tenant-context';

interface SeededOrg {
  organizationId: string;
  userId: string;
  documentId: string;
  governanceIssueId: string;
}

/**
 * Mirrors tenant-isolation.spec.ts's seedOrganization helper (a full,
 * independent data tree via raw prisma calls) — trimmed to only what
 * Notification.upsertByDedupeKey's FKs require (User, Document,
 * GovernanceIssue).
 */
async function seedOrgWithIssue(label: string): Promise<SeededOrg> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const organization = await prisma.organization.create({
    data: { name: `Notification Repository Test Org ${unique}` },
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

  const governanceIssue = await prisma.governanceIssue.create({
    data: {
      organizationId: organization.id,
      documentId: document.id,
      issueType: 'Freshness',
      severity: 'RequiresReview',
      assignedUserId: user.id,
    },
  });

  return { organizationId: organization.id, userId: user.id, documentId: document.id, governanceIssueId: governanceIssue.id };
}

describe('NotificationRepository.upsertByDedupeKey (Phase D.2 review fix — Issue 1)', () => {
  let org: SeededOrg;

  beforeEach(async () => {
    org = await seedOrgWithIssue('upsert');
  }, 30_000);

  afterEach(async () => {
    await prisma.organization.delete({ where: { id: org.organizationId } });
  }, 30_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function upsertInput(dedupeKey: string) {
    return {
      dedupeKey,
      userId: org.userId,
      type: 'ResolutionSuggested' as const,
      message: 'A rescan no longer detects this Freshness issue — confirm and resolve?',
      governanceIssueId: org.governanceIssueId,
      documentId: org.documentId,
    };
  }

  it('creates exactly one Notification when called concurrently with the same dedupeKey — the core concurrency guarantee', async () => {
    const context = createTenantContext(org.organizationId);
    const dedupeKey = `${org.governanceIssueId}:concurrent`;

    // Two "simultaneous" reconciliation runs for the same organization
    // (e.g. event-driven trigger racing the hourly sweep) attempting to
    // suggest a resolution for the SAME issue generation at once.
    const [first, second] = await Promise.all([
      context.notifications.upsertByDedupeKey(upsertInput(dedupeKey)),
      context.notifications.upsertByDedupeKey(upsertInput(dedupeKey)),
    ]);

    expect(first.id).toBe(second.id); // both calls resolved to the SAME row

    const rows = await prisma.notification.findMany({ where: { dedupeKey } });
    expect(rows).toHaveLength(1);
  });

  it('leaves an existing notification untouched (including its read flag) when a duplicate upsert is attempted', async () => {
    const context = createTenantContext(org.organizationId);
    const dedupeKey = `${org.governanceIssueId}:untouched`;

    const created = await context.notifications.upsertByDedupeKey(upsertInput(dedupeKey));
    await prisma.notification.update({ where: { id: created.id }, data: { read: true } });

    // A second, later upsert attempt for the exact same generation (e.g.
    // the periodic safety-net sweep re-evaluating the same still-open
    // issue) must not silently reset what the recipient already read.
    const second = await context.notifications.upsertByDedupeKey(upsertInput(dedupeKey));

    expect(second.id).toBe(created.id);
    expect(second.read).toBe(true);
  });

  it('creates a second, independent notification for a different dedupeKey (a new issue generation)', async () => {
    const context = createTenantContext(org.organizationId);

    const first = await context.notifications.upsertByDedupeKey(upsertInput(`${org.governanceIssueId}:gen-1`));
    const second = await context.notifications.upsertByDedupeKey(upsertInput(`${org.governanceIssueId}:gen-2`));

    expect(first.id).not.toBe(second.id);
    const rows = await prisma.notification.findMany({ where: { governanceIssueId: org.governanceIssueId } });
    expect(rows).toHaveLength(2);
  });

  it('scopes the created row to this organization, matching every other repository method', async () => {
    const context = createTenantContext(org.organizationId);
    const dedupeKey = `${org.governanceIssueId}:scoped`;

    const created = await context.notifications.upsertByDedupeKey(upsertInput(dedupeKey));

    const row = await prisma.notification.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.organizationId).toBe(org.organizationId);
  });
});
