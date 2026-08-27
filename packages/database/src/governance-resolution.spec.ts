import { prisma } from './client';
import { resolveGovernanceIssueForRemediation } from './governance-resolution';

interface SeededOrg {
  organizationId: string;
  userId: string;
  documentId: string;
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const unique = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const organization = await prisma.organization.create({ data: { name: `Governance Resolution Test Org ${unique}` } });
  const microsoftTenant = await prisma.microsoftTenant.create({
    data: { organizationId: organization.id, entraTenantId: `tenant-${unique}`, tenantName: `Test Tenant ${unique}` },
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
      path: `/Test Document ${unique}.docx`,
      fileType: 'docx',
      sizeBytes: 1024,
      sourceCreatedAt: new Date(),
      sourceModifiedAt: new Date(),
    },
  });

  return { organizationId: organization.id, userId: user.id, documentId: document.id };
}

describe('resolveGovernanceIssueForRemediation (ADR-0022 §13.2, Phase 5)', () => {
  let org: SeededOrg;

  beforeEach(async () => {
    org = await seedOrg('gov-resolution');
  }, 30_000);

  afterEach(async () => {
    await prisma.organization.delete({ where: { id: org.organizationId } });
  }, 30_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createIssue(overrides: Partial<{ status: 'Open' | 'InProgress' | 'Resolved'; issueType: string }> = {}) {
    return prisma.governanceIssue.create({
      data: {
        organizationId: org.organizationId,
        documentId: org.documentId,
        issueType: (overrides.issueType ?? 'ReviewStatus') as never,
        severity: 'RequiresReview',
        status: overrides.status ?? 'Open',
      },
    });
  }

  it('resolves an Open GovernanceIssue and records exactly one IssueResolved activity, attributed to the given actor', async () => {
    const issue = await createIssue({ status: 'Open' });

    const result = await resolveGovernanceIssueForRemediation({
      organizationId: org.organizationId,
      documentId: org.documentId,
      issueType: 'ReviewStatus',
      actorUserId: org.userId,
    });

    expect(result).toEqual({ resolved: true });
    const updated = await prisma.governanceIssue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(updated.status).toBe('Resolved');
    expect(updated.resolvedAt).not.toBeNull();

    const activities = await prisma.governanceActivity.findMany({ where: { governanceIssueId: issue.id } });
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      activityType: 'IssueResolved',
      actorUserId: org.userId,
      previousValue: 'Open',
      newValue: 'Resolved',
    });
  });

  it('resolves an InProgress GovernanceIssue directly to Resolved — the exact transition ALLOWED_TRANSITIONS does not permit for the human-facing path', async () => {
    const issue = await createIssue({ status: 'InProgress' });

    const result = await resolveGovernanceIssueForRemediation({
      organizationId: org.organizationId,
      documentId: org.documentId,
      issueType: 'ReviewStatus',
      actorUserId: org.userId,
    });

    expect(result).toEqual({ resolved: true });
    const updated = await prisma.governanceIssue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(updated.status).toBe('Resolved');
  });

  it('does nothing when no GovernanceIssue is tracked for this (documentId, issueType) at all', async () => {
    const result = await resolveGovernanceIssueForRemediation({
      organizationId: org.organizationId,
      documentId: org.documentId,
      issueType: 'ReviewStatus',
      actorUserId: org.userId,
    });

    expect(result).toEqual({ resolved: false });
  });

  it('is idempotent — calling it again on an already-Resolved issue does nothing and creates no second audit entry', async () => {
    const issue = await createIssue({ status: 'Open' });

    await resolveGovernanceIssueForRemediation({
      organizationId: org.organizationId,
      documentId: org.documentId,
      issueType: 'ReviewStatus',
      actorUserId: org.userId,
    });
    const second = await resolveGovernanceIssueForRemediation({
      organizationId: org.organizationId,
      documentId: org.documentId,
      issueType: 'ReviewStatus',
      actorUserId: org.userId,
    });

    expect(second).toEqual({ resolved: false });
    const activities = await prisma.governanceActivity.findMany({ where: { governanceIssueId: issue.id } });
    expect(activities).toHaveLength(1);
  });

  it('only resolves the matching (documentId, issueType) thread — an unrelated issueType on the same document stays untouched', async () => {
    const reviewStatusIssue = await createIssue({ status: 'Open', issueType: 'ReviewStatus' });
    const freshnessIssue = await createIssue({ status: 'Open', issueType: 'Freshness' });

    await resolveGovernanceIssueForRemediation({
      organizationId: org.organizationId,
      documentId: org.documentId,
      issueType: 'ReviewStatus',
      actorUserId: org.userId,
    });

    const updatedReviewStatus = await prisma.governanceIssue.findUniqueOrThrow({ where: { id: reviewStatusIssue.id } });
    const updatedFreshness = await prisma.governanceIssue.findUniqueOrThrow({ where: { id: freshnessIssue.id } });
    expect(updatedReviewStatus.status).toBe('Resolved');
    expect(updatedFreshness.status).toBe('Open'); // untouched
  });

  it('throws and resolves nothing when actorUserId is empty — refuses to resolve without a real actor', async () => {
    const issue = await createIssue({ status: 'Open' });

    await expect(
      resolveGovernanceIssueForRemediation({
        organizationId: org.organizationId,
        documentId: org.documentId,
        issueType: 'ReviewStatus',
        actorUserId: '',
      }),
    ).rejects.toThrow(/actorUserId/);

    const untouched = await prisma.governanceIssue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(untouched.status).toBe('Open');
  });

  it('never leaks across organizations — cannot resolve another organization\'s GovernanceIssue', async () => {
    const otherOrg = await seedOrg('gov-resolution-other');
    const otherIssue = await prisma.governanceIssue.create({
      data: {
        organizationId: otherOrg.organizationId,
        documentId: otherOrg.documentId,
        issueType: 'ReviewStatus',
        severity: 'RequiresReview',
        status: 'Open',
      },
    });

    const result = await resolveGovernanceIssueForRemediation({
      organizationId: org.organizationId, // wrong org
      documentId: otherOrg.documentId,
      issueType: 'ReviewStatus',
      actorUserId: org.userId,
    });

    expect(result).toEqual({ resolved: false });
    const untouched = await prisma.governanceIssue.findUniqueOrThrow({ where: { id: otherIssue.id } });
    expect(untouched.status).toBe('Open');

    await prisma.organization.delete({ where: { id: otherOrg.organizationId } });
  });
});
