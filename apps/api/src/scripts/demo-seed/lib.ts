import { calculateScore } from '@sph/scoring';
import type { DocumentOwnerInput, SiblingDocumentInput } from '@sph/scoring';
import type { TenantContext, HealthIssue as DbHealthIssue } from '@sph/database';

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Runs a document through the REAL scoring algorithm (@sph/scoring) —
 * exactly what apps/worker's DocumentCollectorProcessor.scoreTenantDocuments
 * does — then persists the result via the sanctioned, tenant-scoped
 * repository layer (never raw Prisma). `now` is scoring's own documented
 * override ("Injectable for deterministic testing — defaults to the real
 * current time") — used here to score a document as of a specific
 * historical point, the same mechanism a differently-timed real rescan
 * would have used.
 */
export async function scoreAndPersist(
  context: TenantContext,
  scanJobId: string,
  documentName: string,
  documentId: string,
  owners: DocumentOwnerInput[],
  siblings: SiblingDocumentInput[],
  nextReviewDueAt: Date | null,
  sourceCreatedAt: Date,
  sourceModifiedAt: Date,
  sizeBytes: number,
  scoredAsOf: Date,
): Promise<{ healthScoreId: string; issues: DbHealthIssue[] }> {
  const result = calculateScore({
    documentId,
    documentName,
    sourceCreatedAt,
    sourceModifiedAt,
    sizeBytes,
    nextReviewDueAt,
    owners,
    siblingDocuments: siblings,
    classificationFields: [],
    now: scoredAsOf,
  });

  const healthScore = await context.healthScores.create({
    documentId,
    scanJobId,
    compositeScore: result.score,
    freshnessScore: result.breakdown.Freshness,
    ownershipScore: result.breakdown.Ownership,
    reviewStatusScore: result.breakdown.ReviewStatus,
    metadataScore: result.breakdown.Metadata,
    duplicationScore: result.breakdown.Duplication,
    ageScore: result.breakdown.Age,
    taxonomyScore: result.breakdown.Taxonomy,
    healthBand: result.band,
    calculatedAt: scoredAsOf,
  });

  const issues: DbHealthIssue[] = [];
  for (const issue of result.issues) {
    issues.push(
      await context.healthIssues.create({
        healthScoreId: healthScore.id,
        criterion: issue.type,
        severity: issue.severity,
        message: issue.message,
        createdAt: scoredAsOf,
      }),
    );
  }

  return { healthScoreId: healthScore.id, issues };
}

/**
 * Mirrors NotificationReconciliationService.computeStillDetected
 * (apps/worker/src/notifications/notification-reconciliation.service.ts)
 * for exactly one issue — deliberately re-derived here rather than
 * imported, since that service lives in apps/worker and importing across
 * an app boundary (ADR-0009) for a script that deploys with neither app
 * would be a worse tradeoff than re-stating this small, already-documented
 * algorithm. Any drift between the two would be a real bug; keep them in
 * sync if either ever changes.
 */
export function stillDetected(currentHealthScoreId: string | null, issueType: string, detectedKeys: Set<string>): boolean {
  if (!currentHealthScoreId) return false;
  return detectedKeys.has(`${currentHealthScoreId}:${issueType}`);
}
