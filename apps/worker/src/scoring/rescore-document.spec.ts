import type { TenantContext } from '@sph/database';
import { rescoreDocument } from './rescore-document';

const now = new Date('2026-12-01T00:00:00.000Z');

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    organizationId: 'org-1',
    siteId: 'site-1',
    graphItemId: 'item-1',
    name: 'Report.docx',
    path: '/Report.docx',
    fileType: 'docx',
    sizeBytes: BigInt(2048),
    sourceCreatedAt: new Date('2025-01-01T00:00:00.000Z'),
    sourceModifiedAt: new Date('2025-06-01T00:00:00.000Z'),
    nextReviewDueAt: new Date('2027-01-01T00:00:00.000Z'), // set, so ReviewStatus passes by default
    ...overrides,
  } as never;
}

function makeContext(overrides: Record<string, unknown> = {}): TenantContext {
  return {
    organizationId: 'org-1',
    sharePointSites: { findFirstById: jest.fn().mockResolvedValue({ id: 'site-1', microsoftTenantId: 'tenant-1' }) },
    documentOwners: { findMany: jest.fn().mockResolvedValue([]) },
    users: { findMany: jest.fn().mockResolvedValue([]) },
    documents: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  } as unknown as TenantContext;
}

describe('rescoreDocument (ADR-0022 §3.4/§13.2, Phase 5)', () => {
  it('throws when the document\'s SharePointSite no longer exists', async () => {
    const context = makeContext({ sharePointSites: { findFirstById: jest.fn().mockResolvedValue(null) } });

    await expect(rescoreDocument(context, makeDocument(), now)).rejects.toThrow(/SharePointSite/);
  });

  it('produces no ReviewStatus issue when nextReviewDueAt is set in the future', async () => {
    const context = makeContext();

    const result = await rescoreDocument(context, makeDocument({ nextReviewDueAt: new Date('2027-06-01T00:00:00.000Z') }), now);

    expect(result.issues.some((issue) => issue.type === 'ReviewStatus')).toBe(false);
  });

  it('produces a ReviewStatus issue when nextReviewDueAt is null — the exact criterion SetReviewDateAction remediates', async () => {
    const context = makeContext();

    const result = await rescoreDocument(context, makeDocument({ nextReviewDueAt: null }), now);

    expect(result.issues.some((issue) => issue.type === 'ReviewStatus')).toBe(true);
  });

  it('queries owners scoped to this one document only', async () => {
    const documentOwners = { findMany: jest.fn().mockResolvedValue([]) };
    const context = makeContext({ documentOwners });

    await rescoreDocument(context, makeDocument(), now);

    expect(documentOwners.findMany).toHaveBeenCalledWith({ where: { documentId: 'doc-1' } });
  });

  it('resolves owner isActiveUser via a registered User lookup by email', async () => {
    const documentOwners = { findMany: jest.fn().mockResolvedValue([{ email: 'owner@example.com' }]) };
    const users = { findMany: jest.fn().mockResolvedValue([{ email: 'owner@example.com', status: 'Active' }]) };
    const context = makeContext({ documentOwners, users });

    await rescoreDocument(context, makeDocument(), now);

    expect(users.findMany).toHaveBeenCalledWith({ where: { email: { in: ['owner@example.com'] } } });
  });

  it('does not query users at all when no owner has an email', async () => {
    const documentOwners = { findMany: jest.fn().mockResolvedValue([{ email: null }]) };
    const users = { findMany: jest.fn() };
    const context = makeContext({ documentOwners, users });

    await rescoreDocument(context, makeDocument(), now);

    expect(users.findMany).not.toHaveBeenCalled();
  });

  it('queries sibling documents scoped to this tenant, this document\'s exact name and sizeBytes, and Active status only', async () => {
    const documents = { findMany: jest.fn().mockResolvedValue([]) };
    const context = makeContext({ documents });

    await rescoreDocument(context, makeDocument({ name: 'Report.docx', sizeBytes: BigInt(2048) }), now);

    expect(documents.findMany).toHaveBeenCalledWith({
      where: { status: 'Active', site: { microsoftTenantId: 'tenant-1' }, name: 'Report.docx', sizeBytes: BigInt(2048) },
    });
  });

  it('produces a Duplication issue when another Active document shares the same name and sizeBytes', async () => {
    const documents = {
      findMany: jest.fn().mockResolvedValue([
        { id: 'doc-1', name: 'Report.docx', sizeBytes: BigInt(2048) },
        { id: 'doc-2', name: 'Report.docx', sizeBytes: BigInt(2048) },
      ]),
    };
    const context = makeContext({ documents });

    const result = await rescoreDocument(context, makeDocument(), now);

    expect(result.issues.some((issue) => issue.type === 'Duplication')).toBe(true);
  });

  it('produces the same ScoreResult shape calculateScore normally returns (score, band, issues, breakdown)', async () => {
    const context = makeContext();

    const result = await rescoreDocument(context, makeDocument(), now);

    expect(result).toEqual(
      expect.objectContaining({
        score: expect.any(Number),
        band: expect.any(String),
        issues: expect.any(Array),
        breakdown: expect.objectContaining({ ReviewStatus: expect.any(Number) }),
      }),
    );
  });

  it('never persists anything — no HealthScore/HealthIssue write, compute-only', async () => {
    const healthScores = { create: jest.fn() };
    const healthIssues = { create: jest.fn() };
    const documentsRepo = { findMany: jest.fn().mockResolvedValue([]), updateById: jest.fn() };
    const context = makeContext({ healthScores, healthIssues, documents: documentsRepo });

    await rescoreDocument(context, makeDocument(), now);

    expect(healthScores.create).not.toHaveBeenCalled();
    expect(healthIssues.create).not.toHaveBeenCalled();
    expect(documentsRepo.updateById).not.toHaveBeenCalled();
  });
});
