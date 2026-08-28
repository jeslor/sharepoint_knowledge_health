import { Injectable } from '@nestjs/common';
import { createTenantContext, type Document, type HealthIssue, type TenantContext } from '@sph/database';
import type {
  OwnershipCoverageBucket,
  OwnershipCoverageBySite,
  OwnershipCoverageResponse,
  OwnershipIdentityBreakdown,
  OwnershipSourceBreakdown,
} from '@sph/types';

type CoverageState = 'covered' | 'noIdentifiableOwner' | 'allOwnersInactive' | 'notYetScored';

interface RawBucket {
  covered: number;
  noIdentifiableOwner: number;
  allOwnersInactive: number;
  notYetScored: number;
}

function emptyRawBucket(): RawBucket {
  return { covered: 0, noIdentifiableOwner: 0, allOwnersInactive: 0, notYetScored: 0 };
}

/**
 * ADR-0024 Phase A: read-only ownership coverage reporting, structurally
 * modeled on GovernanceAnalyticsService (same "narrow indexed fetch +
 * batched follow-up query, bucket in Node where a plain-column groupBy
 * can't express the condition, real groupBy where it can" discipline — no
 * $queryRaw, no new Prisma schema).
 *
 * Source of truth (§3.1): coverage state is read directly off whether a
 * document's *current* HealthScore has an Ownership HealthIssue, and that
 * issue's severity — never re-derived from raw DocumentOwner rows. This is
 * deliberate: re-deriving would create a second, parallel definition of
 * "acceptable ownership" that could silently drift from scoreOwnership's
 * actual behavior (packages/scoring/src/rules/ownership.ts, unmodified by
 * this feature).
 */
@Injectable()
export class OwnershipCoverageService {
  async getCoverage(organizationId: string): Promise<OwnershipCoverageResponse> {
    const context = createTenantContext(organizationId);

    // Narrow, indexed fetch — every Active document, org-wide. One query,
    // not a full-table scan (mirrors document-collector.processor.ts's own
    // scoreTenantDocuments query shape exactly: status: 'Active', no
    // site-status filter — see §3.2's Invariant 4 rationale for why a site
    // filter here would be wrong).
    const documents = await context.documents.findMany({ where: { status: 'Active' } });

    const scoredHealthScoreIds = documents
      .map((document) => document.currentHealthScoreId)
      .filter((id): id is string => id !== null);

    // One batched follow-up query, keyed by healthScoreId — never N+1.
    const ownershipIssues =
      scoredHealthScoreIds.length > 0
        ? await context.healthIssues.findMany({
            where: { healthScoreId: { in: scoredHealthScoreIds }, criterion: 'Ownership' },
          })
        : [];
    const issueByHealthScoreId = new Map(ownershipIssues.map((issue) => [issue.healthScoreId, issue]));

    // Every site with at least one Active document — regardless of that
    // site's current status (§3.2's Invariant 4: a Removed site's
    // already-collected documents remain Active and must still be counted).
    const sites = await context.sharePointSites.findMany();
    const siteNameById = new Map(sites.map((site) => [site.id, site.displayName]));

    const organizationBucket = emptyRawBucket();
    const bucketsBySiteId = new Map<string, RawBucket>();

    for (const document of documents) {
      const state = this.classify(document, issueByHealthScoreId);
      organizationBucket[state] += 1;

      const siteBucket = bucketsBySiteId.get(document.siteId) ?? emptyRawBucket();
      siteBucket[state] += 1;
      bucketsBySiteId.set(document.siteId, siteBucket);
    }

    const organizationWide = this.toCoverageBucket(organizationBucket);
    const bySite: OwnershipCoverageBySite[] = [...bucketsBySiteId.entries()].map(([siteId, bucket]) => ({
      siteId,
      siteName: siteNameById.get(siteId) ?? 'Unknown site',
      ...this.toCoverageBucket(bucket),
    }));

    const activeDocumentIds = documents.map((document) => document.id);
    const [ownerSourceBreakdown, identityBreakdown] = await Promise.all([
      this.buildSourceBreakdown(context, activeDocumentIds),
      this.buildIdentityBreakdown(context, activeDocumentIds),
    ]);

    return {
      organizationWide,
      bySite,
      ownerSourceBreakdown,
      identityBreakdown,
      calculatedAt: new Date().toISOString(),
    };
  }

  // §3.1's four-state partition, read directly off the current HealthScore's
  // Ownership HealthIssue (or its absence) — never off raw DocumentOwner rows.
  private classify(document: Document, issueByHealthScoreId: Map<string, HealthIssue>): CoverageState {
    if (!document.currentHealthScoreId) return 'notYetScored';
    const issue = issueByHealthScoreId.get(document.currentHealthScoreId);
    if (!issue) return 'covered';
    // scoreOwnership only ever produces exactly these two non-passing
    // severities for this criterion (score 0 -> RequiresReview, score 40 ->
    // NeedsAttention) — see the ADR's own documented coupling/risk (§9).
    return issue.severity === 'RequiresReview' ? 'noIdentifiableOwner' : 'allOwnersInactive';
  }

  // Invariants 1-3, computed once and reused for both the org-wide bucket
  // and every per-site bucket (never two independently-written formulas).
  private toCoverageBucket(bucket: RawBucket): OwnershipCoverageBucket {
    const totalDocuments = bucket.covered + bucket.noIdentifiableOwner + bucket.allOwnersInactive + bucket.notYetScored;
    const scoredDocuments = bucket.covered + bucket.noIdentifiableOwner + bucket.allOwnersInactive;
    const coveragePercentage = scoredDocuments > 0 ? Math.round((bucket.covered / scoredDocuments) * 100) : null;
    return { ...bucket, totalDocuments, scoredDocuments, coveragePercentage };
  }

  // Invariant 5: an entirely separate, row-level query — never combined
  // with or compared against the coverage buckets above.
  private async buildSourceBreakdown(
    context: TenantContext,
    activeDocumentIds: string[],
  ): Promise<OwnershipSourceBreakdown> {
    if (activeDocumentIds.length === 0) return { graphMetadataCount: 0, manualAssignmentCount: 0 };

    const groups = await context.documentOwners.groupBySource({ documentId: { in: activeDocumentIds } });
    return {
      graphMetadataCount: groups.find((group) => group.source === 'GraphMetadata')?.count ?? 0,
      manualAssignmentCount: groups.find((group) => group.source === 'ManualAssignment')?.count ?? 0,
    };
  }

  // Secondary/descriptive breakdown (§3.2) — an external/unregistered owner
  // is never treated as invalid here, matching §2.4/§2.5's domain rule
  // exactly; this only classifies where each identifiable owner's email
  // (if any) actually resolves.
  private async buildIdentityBreakdown(
    context: TenantContext,
    activeDocumentIds: string[],
  ): Promise<OwnershipIdentityBreakdown> {
    if (activeDocumentIds.length === 0) {
      return { activeRegisteredCount: 0, deactivatedRegisteredCount: 0, externalOrUnregisteredCount: 0 };
    }

    const owners = await context.documentOwners.findMany({
      where: { documentId: { in: activeDocumentIds }, email: { not: null } },
    });

    // Prisma's `email: { not: null }` above does not exclude an empty
    // string. `User.email` is a required, non-nullable column, so an
    // account Entra never returned a mail claim for is stored as "" rather
    // than null — meaning "" can spuriously match a real registered user.
    // An owner row with "" carries no identifiable email at all, so it must
    // be treated as unregistered rather than looked up against User.
    // Whitespace-only ("   ") is deliberately NOT normalized here: no code
    // path in this codebase (Graph ingestion, scoring, resolveOwnerUserId)
    // has ever produced or handled it, so treating it as empty would be
    // speculative rather than fixing a confirmed defect.
    const identifiableOwners = owners.filter((owner) => owner.email !== '');

    const distinctEmails = [...new Set(identifiableOwners.map((owner) => owner.email as string))];
    const registeredUsers =
      distinctEmails.length > 0 ? await context.users.findMany({ where: { email: { in: distinctEmails } } }) : [];
    const statusByEmail = new Map(registeredUsers.map((user) => [user.email, user.status]));

    let activeRegisteredCount = 0;
    let deactivatedRegisteredCount = 0;
    let externalOrUnregisteredCount = owners.length - identifiableOwners.length;
    for (const owner of identifiableOwners) {
      const status = statusByEmail.get(owner.email as string);
      if (status === 'Active') activeRegisteredCount += 1;
      else if (status === 'Deactivated') deactivatedRegisteredCount += 1;
      else externalOrUnregisteredCount += 1;
    }

    return { activeRegisteredCount, deactivatedRegisteredCount, externalOrUnregisteredCount };
  }
}
