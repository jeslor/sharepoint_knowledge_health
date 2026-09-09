import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createTenantContext, type HealthIssue, type HealthScore } from '@sph/database';
import { classifyReviewDateHealth } from '@sph/scoring';
import type {
  AssignDocumentOwnerRequest,
  DocumentDetailResponse,
  DocumentHealthQuery,
  DocumentHealthResponse,
  DocumentOwnerResponse,
  DocumentResponse,
  DocumentReviewResponse,
  DocumentScoreHistoryResponse,
  DocumentTaxonomyCoverage,
  PaginatedResponse,
} from '@sph/types';
import { GovernanceActivityService } from '../governance/governance-activity.service';
import { resolveOwnerUserId } from '../common/resolve-owner-user';

function toDocumentOwnerResponse(owner: {
  id: string;
  ownerType: string;
  displayName: string | null;
  email: string | null;
  source: string;
  assignedByUserId: string | null;
  assignedAt: Date | null;
}): DocumentOwnerResponse {
  return {
    id: owner.id,
    ownerType: owner.ownerType,
    displayName: owner.displayName,
    email: owner.email,
    source: owner.source,
    assignedByUserId: owner.assignedByUserId,
    assignedAt: owner.assignedAt?.toISOString() ?? null,
  };
}

const ORDER_BY_MAP = {
  score: (dir: 'asc' | 'desc') => ({ currentHealthScore: { compositeScore: dir } }),
  name: (dir: 'asc' | 'desc') => ({ name: dir }),
  lastModified: (dir: 'asc' | 'desc') => ({ sourceModifiedAt: dir }),
};

@Injectable()
export class DocumentsService {
  constructor(private readonly governanceActivityService: GovernanceActivityService) {}

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

    const reviewDateMapping = await this.resolveReviewDateMapping(context, document);
    const sharePointManaged = reviewDateMapping?.status === 'Active';

    // ADR-0025: taxonomy coverage presentation state. Derived from the
    // library's CURRENT active classification fields plus whether a
    // taxonomyScore was measured — so a neutral 100 (D=0 at scan time) is
    // never shown as measured coverage, and an unscored/historical row is
    // distinct from both.
    const activeClassificationFields = document.graphListId
      ? await context.sharePointClassificationFields.findManyActiveByLibrary(document.siteId, document.graphListId)
      : [];
    const taxonomyScoreValue = score?.taxonomyScore ?? null;
    const taxonomyCoverage: DocumentTaxonomyCoverage =
      taxonomyScoreValue === null
        ? { state: 'notYetScored', score: null, configuredFieldCount: activeClassificationFields.length }
        : activeClassificationFields.length === 0
          ? { state: 'notConfigured', score: null, configuredFieldCount: 0 }
          : { state: 'measured', score: taxonomyScoreValue, configuredFieldCount: activeClassificationFields.length };

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
      nextReviewDueAt: document.nextReviewDueAt?.toISOString() ?? null,
      reviewDateSource: document.reviewDateSource,
      // Phase 2: only reflects this document's own last-synced state —
      // unchanged by Phase 3A-1, still null unless reviewDateSource is
      // already GraphMetadata. See sharePointManaged below for the
      // library-level signal that's populated even before a first sync.
      reviewDateColumnDisplayName:
        document.reviewDateSource === 'GraphMetadata' ? (reviewDateMapping?.columnDisplayNameAtConfirmation ?? null) : null,
      sharePointManaged,
      sharePointManagedColumnDisplayName: sharePointManaged ? (reviewDateMapping?.columnDisplayNameAtConfirmation ?? null) : null,
      // Phase 3A-1: the authoritative Missing/Overdue/DueSoon/Healthy
      // classification lives in @sph/scoring (the same package that scores
      // ReviewStatus) — computed here, at request time, off the real
      // nextReviewDueAt column, never re-derived in the frontend.
      reviewDateHealth: classifyReviewDateHealth(document.nextReviewDueAt, new Date()),
      taxonomyCoverage,
      webUrl: document.webUrl,
    };
  }

  // Phase 2 (extended Phase 3A-1): the one lookup backing both
  // reviewDateColumnDisplayName (gated on reviewDateSource, unchanged
  // contract) and the new sharePointManaged/sharePointManagedColumnDisplayName
  // fields (independent of reviewDateSource — a library can be Active-mapped
  // before this document's own row has ever synced). One findByLibrary call
  // serves both, avoiding a redundant second lookup. Returns null when the
  // document has no graphListId (never scanned since Phase 1a) or the
  // library has no mapping at all.
  private async resolveReviewDateMapping(
    context: ReturnType<typeof createTenantContext>,
    document: { siteId: string; graphListId: string | null },
  ): Promise<{ status: string; columnDisplayNameAtConfirmation: string } | null> {
    if (!document.graphListId) return null;
    return context.sharePointReviewDateMappings.findByLibrary(document.siteId, document.graphListId);
  }

  // ADR-0015 §4: HealthScore already accumulates one row per document per
  // scan today — no schema change, no recalculation, just an ordered read
  // of data already written by the scoring pipeline.
  async getDocumentHistory(organizationId: string, documentId: string): Promise<DocumentScoreHistoryResponse | null> {
    const context = createTenantContext(organizationId);
    const document = await context.documents.findFirstById(documentId);
    if (!document) return null;

    const scores = await context.healthScores.findMany({
      where: { documentId },
      orderBy: { calculatedAt: 'asc' },
    });

    return {
      documentId,
      points: scores.map((score) => ({
        calculatedAt: score.calculatedAt.toISOString(),
        score: score.compositeScore,
        band: score.healthBand,
      })),
    };
  }

  // ADR-0016 §4.2: returns every DocumentOwner row regardless of source —
  // apps/web distinguishes Graph-derived (read-only display) from
  // ManualAssignment (removable) using the `source` field on each row.
  async listOwners(organizationId: string, documentId: string): Promise<DocumentOwnerResponse[] | null> {
    const context = createTenantContext(organizationId);
    const document = await context.documents.findFirstById(documentId);
    if (!document) return null;

    const owners = await context.documentOwners.findMany({ where: { documentId } });
    return owners.map(toDocumentOwnerResponse);
  }

  // ADR-0016 §4.2: always source: ManualAssignment, ownerType:
  // AssignedOwner — apps/worker's syncOwner() never touches these rows
  // (Phase 8A fix), so this assignment survives every future rescan
  // unchanged until a human explicitly removes it.
  async assignOwner(
    organizationId: string,
    documentId: string,
    assignedByUserId: string,
    request: AssignDocumentOwnerRequest,
  ): Promise<DocumentOwnerResponse | null> {
    const context = createTenantContext(organizationId);
    const document = await context.documents.findFirstById(documentId);
    if (!document) return null;

    const owner = await context.documentOwners.create({
      documentId,
      ownerType: 'AssignedOwner',
      displayName: request.displayName ?? null,
      email: request.email ?? null,
      source: 'ManualAssignment',
      assignedByUserId,
      assignedAt: new Date(),
    });

    // The new owner is only a resolvable notification recipient if their
    // email matches a registered, Active platform User — an external or
    // not-yet-registered owner is a normal, expected case, not an error
    // (resolveOwnerUserId returns null rather than throwing).
    const notifyUserId = await resolveOwnerUserId(context, owner.email);

    await this.governanceActivityService.record(organizationId, {
      documentId,
      actorUserId: assignedByUserId,
      activityType: 'OwnerAssigned',
      newValue: owner.displayName ?? owner.email,
      notifyUserId,
    });

    return toDocumentOwnerResponse(owner);
  }

  // Only ever removes a source: ManualAssignment row — a GraphMetadata row
  // is worker-owned and not deletable through this path (ADR-0016 §4.2).
  async removeOwner(organizationId: string, documentId: string, ownerId: string, actorUserId: string): Promise<void> {
    const context = createTenantContext(organizationId);
    const owner = await context.documentOwners.findMany({ where: { id: ownerId, documentId }, take: 1 });
    const [existing] = owner;
    if (!existing) throw new NotFoundException('Document owner not found');
    if (existing.source !== 'ManualAssignment') {
      throw new ConflictException('Only a manually assigned owner can be removed');
    }
    await context.documentOwners.deleteById(ownerId);

    await this.governanceActivityService.record(organizationId, {
      documentId,
      actorUserId,
      activityType: 'OwnerRemoved',
      previousValue: existing.displayName ?? existing.email,
    });
  }

  // ADR-0002 amendment / ADR-0016 §4.3, §7, §17.4: the write path for a
  // manually-set Document.nextReviewDueAt. Always stamps reviewDateSource:
  // Manual; passing null clears a previously-set date. Rejects (409) when
  // the document's library has an Active SharePointReviewDateMapping —
  // ADR-0016 §17.1 already makes SharePoint authoritative in that state at
  // sync time; this guard closes the gap where a manual edit could
  // otherwise appear to succeed here and then be silently overwritten by
  // the next scan with no explanation ever surfaced to the user.
  async setReviewDate(
    organizationId: string,
    documentId: string,
    nextReviewDueAt: string | null,
  ): Promise<DocumentReviewResponse | null> {
    const context = createTenantContext(organizationId);
    const document = await context.documents.findFirstById(documentId);
    if (!document) return null;

    const reviewDateMapping = await this.resolveReviewDateMapping(context, document);
    if (reviewDateMapping?.status === 'Active') {
      throw new ConflictException(
        `Review dates for this library are managed by SharePoint (column: "${reviewDateMapping.columnDisplayNameAtConfirmation}"). Update the value in SharePoint, or remove the mapping in Knowledge Health before setting a manual review date.`,
      );
    }

    const updated = await context.documents.updateById(documentId, {
      nextReviewDueAt: nextReviewDueAt !== null ? new Date(nextReviewDueAt) : null,
      reviewDateSource: 'Manual',
    });
    if (!updated) return null;

    return {
      documentId: updated.id,
      nextReviewDueAt: updated.nextReviewDueAt?.toISOString() ?? null,
      reviewDateSource: updated.reviewDateSource,
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

    // Phase 3A-1: one `now` shared across the whole page, not re-read per
    // row — a page of documents is judged against a single instant,
    // matching the request/response boundary this endpoint already is.
    const now = new Date();

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
        nextReviewDueAt: document.nextReviewDueAt?.toISOString() ?? null,
        reviewDateHealth: classifyReviewDateHealth(document.nextReviewDueAt, now),
      });
    }

    return {
      data,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }
}
