import { Injectable } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import type { HealthTrendResponse } from '@sph/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class HealthTrendsService {
  // ADR-0015 §4: no aggregation happens here — HealthSnapshot rows are
  // already the aggregate, written once by the worker at scan completion.
  // This is a plain range read, ordered oldest-first for chart-ready output.
  async getOrganizationTrend(organizationId: string, days: number): Promise<HealthTrendResponse> {
    const context = createTenantContext(organizationId);
    const since = new Date(Date.now() - days * MS_PER_DAY);

    const snapshots = await context.healthSnapshots.findMany({
      where: { capturedAt: { gte: since } },
      orderBy: { capturedAt: 'asc' },
    });

    return {
      days,
      points: snapshots.map((snapshot) => ({
        capturedAt: snapshot.capturedAt.toISOString(),
        averageHealthScore: snapshot.averageHealthScore,
        criticalIssuesCount: snapshot.criticalIssuesCount,
        warningIssuesCount: snapshot.warningIssuesCount,
        totalDocumentsScanned: snapshot.totalDocumentsScanned,
      })),
    };
  }
}
