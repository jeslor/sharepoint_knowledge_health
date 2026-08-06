import { prisma } from './client';
import { findOrganizationIdsWithOpenGovernanceIssues } from './notification-reconciliation';
import type { GovernanceIssueStatus } from '@prisma/client';

interface SeededOrg {
  organizationId: string;
}

async function seedOrgWithGovernanceIssue(label: string, status: GovernanceIssueStatus): Promise<SeededOrg> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const organization = await prisma.organization.create({
    data: { name: `Notification Reconciliation Test Org ${unique}` },
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

  await prisma.governanceIssue.create({
    data: {
      organizationId: organization.id,
      documentId: document.id,
      issueType: 'Freshness',
      severity: 'RequiresReview',
      status,
    },
  });

  return { organizationId: organization.id };
}

describe('findOrganizationIdsWithOpenGovernanceIssues (the third sanctioned unscoped query)', () => {
  let openOrg: SeededOrg;
  let inProgressOrg: SeededOrg;
  let resolvedOnlyOrg: SeededOrg;

  beforeAll(async () => {
    // Two different organizations, one Open and one InProgress — proves the
    // query is genuinely cross-tenant and matches both statuses that count
    // as "still needs a reconciliation check", not just one.
    openOrg = await seedOrgWithGovernanceIssue('open', 'Open');
    inProgressOrg = await seedOrgWithGovernanceIssue('in-progress', 'InProgress');
    resolvedOnlyOrg = await seedOrgWithGovernanceIssue('resolved-only', 'Resolved');
  }, 30_000);

  afterAll(async () => {
    await prisma.organization.deleteMany({
      where: { id: { in: [openOrg.organizationId, inProgressOrg.organizationId, resolvedOnlyOrg.organizationId] } },
    });
    await prisma.$disconnect();
  }, 30_000);

  it('returns organizations with an Open or InProgress GovernanceIssue, from every organization, not just one', async () => {
    const results = await findOrganizationIdsWithOpenGovernanceIssues();

    expect(results).toContain(openOrg.organizationId);
    expect(results).toContain(inProgressOrg.organizationId);
  });

  it('excludes an organization whose only GovernanceIssue is already Resolved', async () => {
    const results = await findOrganizationIdsWithOpenGovernanceIssues();

    expect(results).not.toContain(resolvedOnlyOrg.organizationId);
  });

  it('returns each organizationId at most once, even with multiple open issues', async () => {
    const document = await prisma.document.findFirstOrThrow({ where: { organizationId: openOrg.organizationId } });
    await prisma.governanceIssue.create({
      data: {
        organizationId: openOrg.organizationId,
        documentId: document.id,
        issueType: 'Ownership',
        severity: 'NeedsAttention',
        status: 'Open',
      },
    });

    const results = await findOrganizationIdsWithOpenGovernanceIssues();

    expect(results.filter((id) => id === openOrg.organizationId)).toHaveLength(1);
  });
});
