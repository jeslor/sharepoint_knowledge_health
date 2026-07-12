import { Injectable } from '@nestjs/common';
import { createTenantContext, type HealthIssue, type HealthScore } from '@sph/database';
import type {
  DocumentDetailResponse,
  DocumentHealthQuery,
  DocumentHealthResponse,
  DocumentResponse,
  PaginatedResponse,
} from '@sph/types';

const ORDER_BY_MAP = {
  score: (dir: 'asc' | 'desc') => ({ currentHealthScore: { compositeScore: dir } }),
  name: (dir: 'asc' | 'desc') => ({ name: dir }),
  lastModified: (dir: 'asc' | 'desc') => ({ sourceModifiedAt: dir }),
};

@Injectable()
export class DocumentsService {
  async listDocuments(organizationId: string): Promise<DocumentResponse[]> {
    const context = createTenantContext(organizationId);
    const documents = await context.documents.findMany({ orderBy: { name: 'asc' } });

    return documents.map((document) => ({
      id: document.id,
      siteId: document.siteId,
      graphItemId: document.graphItemId,
      name: document.name,
      path: document.path,
      fileType: document.fileType,
      sizeBytes: document.sizeBytes.toString(),
      sourceCreatedAt: document.sourceCreatedAt.toISOString(),
      sourceModifiedAt: document.sourceModifiedAt.toISOString(),
      status: document.status,
      currentHealthScoreId: document.currentHealthScoreId,
      ingestedAt: document.ingestedAt.toISOString(),
    }));
  }

  async getDocument(organizationId: string, documentId: string): Promise<DocumentDetailResponse | null> {
    const context = createTenantContext(organizationId);
    const document = await context.documents.findFirstById(documentId);
    if (!document) return null;

    const [site] = await context.sharePointSites.findMany({ where: { id: document.siteId }, take: 1 });
    const owners = await context.documentOwners.findMany({ where: { documentId: document.id } });
    const primaryOwner = owners[0];

    let score: HealthScore | undefined;
    let issues: HealthIssue[] = [];
    if (document.currentHealthScoreId) {
      const [healthScore] = await context.healthScores.findMany({
        where: { id: document.currentHealthScoreId },
        take: 1,
      });
      score = healthScore;
      if (score) {
        issues = await context.healthIssues.findMany({ where: { healthScoreId: score.id } });
      }
    }

    return {
      documentId: document.id,
      documentName: document.name,
      siteId: document.siteId,
      siteName: site?.displayName ?? 'Unknown site',
      path: document.path,
      fileType: document.fileType,
      sizeBytes: document.sizeBytes.toString(),
      owner: primaryOwner?.displayName ?? null,
      ownerEmail: primaryOwner?.email ?? null,
      status: document.status,
      sourceCreatedAt: document.sourceCreatedAt.toISOString(),
      sourceModifiedAt: document.sourceModifiedAt.toISOString(),
      score: score?.compositeScore ?? null,
      band: score?.healthBand ?? null,
      calculatedAt: score?.calculatedAt.toISOString() ?? null,
      issues: issues.map((issue) => ({ type: issue.criterion, severity: issue.severity, message: issue.message })),
    };
  }

  async listDocumentHealth(
    organizationId: string,
    query: DocumentHealthQuery,
  ): Promise<PaginatedResponse<DocumentHealthResponse>> {
    const context = createTenantContext(organizationId);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const sortBy = query.sortBy ?? 'score';
    const sortDir = query.sortDir ?? 'asc';

    const scoreRange: { gte?: number; lte?: number } = {};
    if (query.minScore !== undefined) scoreRange.gte = query.minScore;
    if (query.maxScore !== undefined) scoreRange.lte = query.maxScore;

    const currentHealthScoreFilter: {
      compositeScore?: typeof scoreRange;
      healthIssues?: { some: { severity: NonNullable<typeof query.severity> } };
    } = {};
    if (query.minScore !== undefined || query.maxScore !== undefined) {
      currentHealthScoreFilter.compositeScore = scoreRange;
    }
    if (query.severity !== undefined) {
      currentHealthScoreFilter.healthIssues = { some: { severity: query.severity } };
    }

    // Removed documents (deleted from SharePoint, reconciled by the
    // Document Collector) keep their last-known score in history but
    // shouldn't surface in the "current health" view as if still live.
    const where = {
      status: 'Active' as const,
      currentHealthScoreId: { not: null },
      ...(query.siteId !== undefined ? { siteId: query.siteId } : {}),
      ...(Object.keys(currentHealthScoreFilter).length > 0
        ? { currentHealthScore: { is: currentHealthScoreFilter } }
        : {}),
    };

    // Pagination, sorting, and filtering are all pushed to the database via
    // Document's real currentHealthScore relation — no in-memory sort/slice.
    const [documents, total] = await Promise.all([
      context.documents.findMany({
        where,
        orderBy: ORDER_BY_MAP[sortBy](sortDir),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      context.documents.count({ where }),
    ]);

    const healthScoreIds = documents
      .map((document) => document.currentHealthScoreId)
      .filter((id): id is string => id !== null);

    const siteIds = [...new Set(documents.map((document) => document.siteId))];
    const documentIds = documents.map((document) => document.id);

    // Batched queries only (not per-row) — avoids N+1 regardless of page size.
    const [healthScores, healthIssues, sites, owners] = await Promise.all([
      healthScoreIds.length > 0 ? context.healthScores.findMany({ where: { id: { in: healthScoreIds } } }) : [],
      healthScoreIds.length > 0
        ? context.healthIssues.findMany({ where: { healthScoreId: { in: healthScoreIds } } })
        : [],
      siteIds.length > 0 ? context.sharePointSites.findMany({ where: { id: { in: siteIds } } }) : [],
      documentIds.length > 0 ? context.documentOwners.findMany({ where: { documentId: { in: documentIds } } }) : [],
    ]);

    const healthScoreById = new Map(healthScores.map((score) => [score.id, score]));
    const siteNameById = new Map(sites.map((site) => [site.id, site.displayName]));

    const issuesByScoreId = new Map<string, HealthIssue[]>();
    for (const issue of healthIssues) {
      const existing = issuesByScoreId.get(issue.healthScoreId) ?? [];
      existing.push(issue);
      issuesByScoreId.set(issue.healthScoreId, existing);
    }

    const ownerByDocumentId = new Map<string, string>();
    for (const owner of owners) {
      if (!ownerByDocumentId.has(owner.documentId) && owner.displayName) {
        ownerByDocumentId.set(owner.documentId, owner.displayName);
      }
    }

    const data: DocumentHealthResponse[] = [];
    for (const document of documents) {
      const score = document.currentHealthScoreId ? healthScoreById.get(document.currentHealthScoreId) : undefined;
      if (!score) continue;

      const issues = issuesByScoreId.get(score.id) ?? [];
      data.push({
        documentId: document.id,
        documentName: document.name,
        siteId: document.siteId,
        siteName: siteNameById.get(document.siteId) ?? 'Unknown site',
        owner: ownerByDocumentId.get(document.id) ?? null,
        status: document.status,
        lastModifiedAt: document.sourceModifiedAt.toISOString(),
        score: score.compositeScore,
        band: score.healthBand,
        issueCount: issues.length,
        calculatedAt: score.calculatedAt.toISOString(),
        issues: issues.map((issue) => ({ type: issue.criterion, severity: issue.severity, message: issue.message })),
      });
    }

    return {
      data,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }
}
