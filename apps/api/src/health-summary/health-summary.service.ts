import { Injectable } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import type { HealthSummaryResponse } from '@sph/types';

@Injectable()
export class HealthSummaryService {
  async getSummary(organizationId: string): Promise<HealthSummaryResponse> {
    const context = createTenantContext(organizationId);

    const documents = await context.documents.findMany({
      where: { status: 'Active', currentHealthScoreId: { not: null } },
    });

    const healthScoreIds = documents
      .map((document) => document.currentHealthScoreId)
      .filter((id): id is string => id !== null);

    const [healthScores, healthIssues, [latestScan], [lastCompletedScan]] = await Promise.all([
      healthScoreIds.length > 0 ? context.healthScores.findMany({ where: { id: { in: healthScoreIds } } }) : [],
      healthScoreIds.length > 0
        ? context.healthIssues.findMany({ where: { healthScoreId: { in: healthScoreIds } } })
        : [],
      context.scanJobs.findMany({ orderBy: { createdAt: 'desc' }, take: 1 }),
      context.scanJobs.findMany({ where: { status: 'Completed' }, orderBy: { completedAt: 'desc' }, take: 1 }),
    ]);

    const averageHealthScore =
      healthScores.length > 0
        ? Math.round(healthScores.reduce((sum, score) => sum + score.compositeScore, 0) / healthScores.length)
        : null;

    const criticalIssuesCount = healthIssues.filter((issue) => issue.severity === 'RequiresReview').length;
    const warningIssuesCount = healthIssues.filter((issue) => issue.severity === 'NeedsAttention').length;

    return {
      totalDocumentsScanned: documents.length,
      averageHealthScore,
      criticalIssuesCount,
      warningIssuesCount,
      lastSuccessfulScanAt: lastCompletedScan?.completedAt?.toISOString() ?? null,
      currentScanStatus: latestScan?.status ?? null,
    };
  }
}
