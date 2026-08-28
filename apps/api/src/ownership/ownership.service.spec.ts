import { createTenantContext } from '@sph/database';
import { OwnershipCoverageService } from './ownership.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

function document(overrides: Partial<{ id: string; siteId: string; currentHealthScoreId: string | null }> = {}) {
  return { id: 'doc-1', siteId: 'site-1', currentHealthScoreId: 'score-1', ...overrides };
}

describe('OwnershipCoverageService (ADR-0024 Phase A)', () => {
  const service = new OwnershipCoverageService();

  const documents = { findMany: jest.fn() };
  const healthIssues = { findMany: jest.fn() };
  const sharePointSites = { findMany: jest.fn() };
  const documentOwners = { findMany: jest.fn(), groupBySource: jest.fn() };
  const users = { findMany: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ documents, healthIssues, sharePointSites, documentOwners, users } as never);
    documents.findMany.mockResolvedValue([]);
    healthIssues.findMany.mockResolvedValue([]);
    sharePointSites.findMany.mockResolvedValue([]);
    documentOwners.findMany.mockResolvedValue([]);
    documentOwners.groupBySource.mockResolvedValue([]);
    users.findMany.mockResolvedValue([]);
  });

  describe('Invariant 1 — bucket exhaustiveness (covered + noIdentifiableOwner + allOwnersInactive + notYetScored === totalDocuments)', () => {
    it('sums correctly across a fixture spanning all four states', async () => {
      documents.findMany.mockResolvedValue([
        document({ id: 'doc-covered', currentHealthScoreId: 'score-covered' }),
        document({ id: 'doc-missing', currentHealthScoreId: 'score-missing' }),
        document({ id: 'doc-inactive', currentHealthScoreId: 'score-inactive' }),
        document({ id: 'doc-unscored', currentHealthScoreId: null }),
      ]);
      healthIssues.findMany.mockResolvedValue([
        { healthScoreId: 'score-missing', criterion: 'Ownership', severity: 'RequiresReview' },
        { healthScoreId: 'score-inactive', criterion: 'Ownership', severity: 'NeedsAttention' },
      ]);

      const result = await service.getCoverage('org-1');

      expect(result.organizationWide).toMatchObject({
        covered: 1,
        noIdentifiableOwner: 1,
        allOwnersInactive: 1,
        notYetScored: 1,
        totalDocuments: 4,
      });
      expect(
        result.organizationWide.covered +
          result.organizationWide.noIdentifiableOwner +
          result.organizationWide.allOwnersInactive +
          result.organizationWide.notYetScored,
      ).toBe(result.organizationWide.totalDocuments);
    });

    it('classifies a document with no Ownership issue on its current score as covered', async () => {
      documents.findMany.mockResolvedValue([document({ currentHealthScoreId: 'score-1' })]);
      healthIssues.findMany.mockResolvedValue([]); // no Ownership issue at all

      const result = await service.getCoverage('org-1');

      expect(result.organizationWide.covered).toBe(1);
    });
  });

  describe('Invariant 2 — scoredDocuments === covered + noIdentifiableOwner + allOwnersInactive', () => {
    it('excludes notYetScored documents from scoredDocuments', async () => {
      documents.findMany.mockResolvedValue([
        document({ id: 'doc-1', currentHealthScoreId: 'score-1' }),
        document({ id: 'doc-2', currentHealthScoreId: null }),
        document({ id: 'doc-3', currentHealthScoreId: null }),
      ]);
      healthIssues.findMany.mockResolvedValue([]);

      const result = await service.getCoverage('org-1');

      expect(result.organizationWide.scoredDocuments).toBe(1);
      expect(result.organizationWide.notYetScored).toBe(2);
      expect(result.organizationWide.scoredDocuments).toBe(
        result.organizationWide.covered + result.organizationWide.noIdentifiableOwner + result.organizationWide.allOwnersInactive,
      );
    });
  });

  describe('Invariant 3 — coveragePercentage formula and null handling', () => {
    it('is null (not 0, not NaN) when there are zero active documents', async () => {
      documents.findMany.mockResolvedValue([]);

      const result = await service.getCoverage('org-1');

      expect(result.organizationWide.totalDocuments).toBe(0);
      expect(result.organizationWide.scoredDocuments).toBe(0);
      expect(result.organizationWide.coveragePercentage).toBeNull();
    });

    it('is null (not 0) when active documents exist but none are scored yet', async () => {
      documents.findMany.mockResolvedValue([
        document({ id: 'doc-1', currentHealthScoreId: null }),
        document({ id: 'doc-2', currentHealthScoreId: null }),
      ]);

      const result = await service.getCoverage('org-1');

      expect(result.organizationWide.totalDocuments).toBe(2);
      expect(result.organizationWide.scoredDocuments).toBe(0);
      expect(result.organizationWide.coveragePercentage).toBeNull();
    });

    it('divides by scoredDocuments, never by totalDocuments — an unscored document never silently lowers the percentage', async () => {
      // 1 covered, 1 unscored: naive (covered / totalDocuments) would be 50%;
      // the correct (covered / scoredDocuments) is 100%.
      documents.findMany.mockResolvedValue([
        document({ id: 'doc-covered', currentHealthScoreId: 'score-covered' }),
        document({ id: 'doc-unscored', currentHealthScoreId: null }),
      ]);
      healthIssues.findMany.mockResolvedValue([]);

      const result = await service.getCoverage('org-1');

      expect(result.organizationWide.coveragePercentage).toBe(100);
    });

    it('rounds to the nearest whole percent', async () => {
      documents.findMany.mockResolvedValue([
        document({ id: 'doc-1', currentHealthScoreId: 'score-1' }),
        document({ id: 'doc-2', currentHealthScoreId: 'score-2' }),
        document({ id: 'doc-3', currentHealthScoreId: 'score-3' }),
      ]);
      healthIssues.findMany.mockResolvedValue([{ healthScoreId: 'score-3', criterion: 'Ownership', severity: 'RequiresReview' }]);

      const result = await service.getCoverage('org-1');

      // 2 of 3 scored documents covered -> 66.67% -> rounds to 67.
      expect(result.organizationWide.coveragePercentage).toBe(67);
    });
  });

  describe('Invariant 4 — sum(bySite.totalDocuments) === organizationWide.totalDocuments', () => {
    it('includes a site with active documents regardless of the site not being Approved', async () => {
      documents.findMany.mockResolvedValue([
        document({ id: 'doc-1', siteId: 'site-removed', currentHealthScoreId: 'score-1' }),
        document({ id: 'doc-2', siteId: 'site-approved', currentHealthScoreId: 'score-2' }),
      ]);
      healthIssues.findMany.mockResolvedValue([]);
      // The service never filters sites by status — a Removed site with
      // active documents must still appear (§3.2's Invariant 4 rationale).
      sharePointSites.findMany.mockResolvedValue([
        { id: 'site-removed', displayName: 'Old Site', status: 'Removed' },
        { id: 'site-approved', displayName: 'Current Site', status: 'Approved' },
      ]);

      const result = await service.getCoverage('org-1');

      const removedSiteBucket = result.bySite.find((site) => site.siteId === 'site-removed');
      expect(removedSiteBucket).toBeDefined();
      expect(removedSiteBucket?.totalDocuments).toBe(1);
      expect(removedSiteBucket?.siteName).toBe('Old Site');

      const sumBySite = result.bySite.reduce((sum, site) => sum + site.totalDocuments, 0);
      expect(sumBySite).toBe(result.organizationWide.totalDocuments);
    });

    it('does not query sharePointSites with any status filter', async () => {
      documents.findMany.mockResolvedValue([document()]);

      await service.getCoverage('org-1');

      expect(sharePointSites.findMany).toHaveBeenCalledWith();
    });

    it('reconciles org-wide and per-site totals across a multi-site, mixed-state fixture', async () => {
      documents.findMany.mockResolvedValue([
        document({ id: 'doc-1', siteId: 'site-a', currentHealthScoreId: 'score-1' }),
        document({ id: 'doc-2', siteId: 'site-a', currentHealthScoreId: null }),
        document({ id: 'doc-3', siteId: 'site-b', currentHealthScoreId: 'score-3' }),
      ]);
      healthIssues.findMany.mockResolvedValue([{ healthScoreId: 'score-3', criterion: 'Ownership', severity: 'NeedsAttention' }]);
      sharePointSites.findMany.mockResolvedValue([
        { id: 'site-a', displayName: 'Site A' },
        { id: 'site-b', displayName: 'Site B' },
      ]);

      const result = await service.getCoverage('org-1');

      expect(result.bySite).toHaveLength(2);
      const sumBySite = result.bySite.reduce((sum, site) => sum + site.totalDocuments, 0);
      expect(sumBySite).toBe(result.organizationWide.totalDocuments);
      expect(result.organizationWide.totalDocuments).toBe(3);
    });
  });

  describe('Invariant 5 — owner-source/identity breakdowns are independent of the coverage buckets', () => {
    it('computes owner-source counts from a separate groupBySource query, not from the coverage fetch', async () => {
      documents.findMany.mockResolvedValue([document({ id: 'doc-1' }), document({ id: 'doc-2' })]);
      documentOwners.groupBySource.mockResolvedValue([
        { source: 'GraphMetadata', count: 3 },
        { source: 'ManualAssignment', count: 2 },
      ]);

      const result = await service.getCoverage('org-1');

      expect(documentOwners.groupBySource).toHaveBeenCalledWith({ documentId: { in: ['doc-1', 'doc-2'] } });
      expect(result.ownerSourceBreakdown).toEqual({ graphMetadataCount: 3, manualAssignmentCount: 2 });
    });

    it('returns zero counts for owner source/identity breakdowns when there are no active documents', async () => {
      documents.findMany.mockResolvedValue([]);

      const result = await service.getCoverage('org-1');

      expect(result.ownerSourceBreakdown).toEqual({ graphMetadataCount: 0, manualAssignmentCount: 0 });
      expect(result.identityBreakdown).toEqual({
        activeRegisteredCount: 0,
        deactivatedRegisteredCount: 0,
        externalOrUnregisteredCount: 0,
      });
      expect(documentOwners.groupBySource).not.toHaveBeenCalled();
    });
  });

  describe('multi-owner identity breakdown (§2.5 — external does not offset inactive)', () => {
    it('counts an external/unregistered owner and a deactivated registered owner independently, on the same or different documents', async () => {
      documents.findMany.mockResolvedValue([document({ id: 'doc-1' })]);
      documentOwners.findMany.mockResolvedValue([
        { documentId: 'doc-1', email: 'external@partner.com', source: 'ManualAssignment' },
        { documentId: 'doc-1', email: 'deactivated@org.com', source: 'GraphMetadata' },
        { documentId: 'doc-1', email: 'active@org.com', source: 'ManualAssignment' },
      ]);
      users.findMany.mockResolvedValue([
        { email: 'deactivated@org.com', status: 'Deactivated' },
        { email: 'active@org.com', status: 'Active' },
      ]);

      const result = await service.getCoverage('org-1');

      expect(result.identityBreakdown).toEqual({
        activeRegisteredCount: 1,
        deactivatedRegisteredCount: 1,
        externalOrUnregisteredCount: 1,
      });
    });

    it('excludes owner rows with a null email from the identity breakdown query', async () => {
      documents.findMany.mockResolvedValue([document({ id: 'doc-1' })]);

      await service.getCoverage('org-1');

      expect(documentOwners.findMany).toHaveBeenCalledWith({ where: { documentId: { in: ['doc-1'] }, email: { not: null } } });
    });

    it('treats an owner with an empty-string email as unregistered, even when a real registered User also has an empty-string email (ADR-0024 live-validation regression)', async () => {
      // Reproduces the exact live-tenant shape: DocumentOwner.email is ""
      // (not null) for an owner with no identifiable email, and this
      // organization also has a real registered, Active User whose own
      // email is "" (User.email is required/non-nullable, so an account
      // Entra never returned a mail claim for is stored as "" rather than
      // null). Prisma's `email: { not: null }` filter does not exclude "",
      // so without the fix this owner spuriously matches that User and is
      // miscounted as activeRegistered instead of externalOrUnregistered.
      documents.findMany.mockResolvedValue([document({ id: 'doc-1' })]);
      documentOwners.findMany.mockResolvedValue([
        { documentId: 'doc-1', email: '', source: 'GraphMetadata' },
        { documentId: 'doc-1', email: 'active@org.com', source: 'ManualAssignment' },
        { documentId: 'doc-1', email: 'deactivated@org.com', source: 'GraphMetadata' },
        { documentId: 'doc-1', email: 'external@partner.com', source: 'ManualAssignment' },
      ]);
      users.findMany.mockResolvedValue([
        { email: '', status: 'Active' },
        { email: 'active@org.com', status: 'Active' },
        { email: 'deactivated@org.com', status: 'Deactivated' },
      ]);

      const result = await service.getCoverage('org-1');

      expect(result.identityBreakdown).toEqual({
        activeRegisteredCount: 1,
        deactivatedRegisteredCount: 1,
        externalOrUnregisteredCount: 2,
      });
      // The empty-email owner must never be looked up against User at all.
      const usersFindManyArg = users.findMany.mock.calls[0][0];
      expect(usersFindManyArg.where.email.in).not.toContain('');
      expect(usersFindManyArg.where.email.in).toEqual(
        expect.arrayContaining(['active@org.com', 'deactivated@org.com', 'external@partner.com']),
      );
    });
  });

  it('does not call healthIssues.findMany at all when there are no scored documents (avoids an empty-array IN query)', async () => {
    documents.findMany.mockResolvedValue([document({ currentHealthScoreId: null })]);

    await service.getCoverage('org-1');

    expect(healthIssues.findMany).not.toHaveBeenCalled();
  });

  it('sets calculatedAt to a real, current ISO timestamp', async () => {
    const before = Date.now();
    const result = await service.getCoverage('org-1');
    const after = Date.now();

    const calculatedAtMs = new Date(result.calculatedAt).getTime();
    expect(calculatedAtMs).toBeGreaterThanOrEqual(before);
    expect(calculatedAtMs).toBeLessThanOrEqual(after);
  });
});
