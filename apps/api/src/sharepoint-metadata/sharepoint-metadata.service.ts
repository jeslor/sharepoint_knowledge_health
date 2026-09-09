import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createTenantContext, type SharePointReviewDateMapping, type SharePointClassificationField } from '@sph/database';
import { listColumns, listContentTypes, listDrives, type GraphColumnDefinition } from '@sph/graph-client';
import { resolveReviewDateCandidates, scoreReviewDateCandidateConfidence } from '@sph/review-date-discovery';
import type {
  ReviewDateEligibilityColumn,
  ReviewDateEligibilityResponse,
  ReviewDateLibraryResponse,
  ReviewDateMappingResponse,
  ClassificationCandidateColumn,
  ClassificationFieldResponse,
  ClassificationLibraryResponse,
} from '@sph/types';

async function collectAsync<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) results.push(item);
  return results;
}

function toEligibilityColumn(column: GraphColumnDefinition): ReviewDateEligibilityColumn {
  return {
    id: column.id,
    name: column.name,
    displayName: column.displayName,
    confidence: scoreReviewDateCandidateConfidence(column),
  };
}

/**
 * Phase 1b/1.1/2: the confirm action, a read-only eligibility check, and a
 * read-only library listing. All three share the same live-discovery-
 * then-filter logic (resolveDiscoveredCandidates below) — confirm throws
 * on an unresolvable 0/1/many result (it's a mutating action that must
 * fail loudly), eligibility returns a discriminated union (an inspection
 * action that must never throw for a merely ambiguous/empty state — only
 * for genuine failures), and library listing never calls discovery at all
 * (see listReviewDateLibraries's own doc comment for why).
 *
 * Phase 1.2 (production hardening): confirmReviewDateMapping logs exactly
 * once per attempt (success or failure, never both), plain key=value
 * lines matching this codebase's existing logging convention (apps/api's
 * request-logger.middleware.ts) — not JSON, no new logging dependency.
 * checkReviewDateEligibility/listReviewDateLibraries are deliberately NOT
 * logged (read-only inspection, not a lifecycle event worth an audit-style
 * line) — their Graph calls still get their own correlationId.
 */
@Injectable()
export class SharePointMetadataService {
  private readonly logger = new Logger(SharePointMetadataService.name);

  async confirmReviewDateMapping(
    organizationId: string,
    siteId: string,
    graphListId: string,
    confirmedByUserId: string,
    selectedColumnDefinitionId?: string,
  ): Promise<ReviewDateMappingResponse> {
    const correlationId = randomUUID();
    const startedAt = Date.now();
    const context = createTenantContext(organizationId);

    try {
      const { candidates } = await this.resolveDiscoveredCandidates(context, siteId, graphListId, correlationId);

      const candidate = this.selectConfirmCandidate(candidates, selectedColumnDefinitionId);

      // Atomic upsert, not a findByLibrary-then-create/update sequence — see
      // the repository method's own doc comment for why: two simultaneous
      // first-time confirmations of the same library must not be able to
      // race an unhandled unique-constraint error back to the second caller.
      const mapping = await context.sharePointReviewDateMappings.upsertActive({
        siteId,
        graphListId,
        columnDefinitionId: candidate.id,
        columnDisplayNameAtConfirmation: candidate.displayName,
        confirmedByUserId,
      });

      this.logger.log(
        `ReviewDateConfirm succeeded organizationId=${organizationId} siteId=${siteId} graphListId=${graphListId} ` +
          `columnDefinitionId=${candidate.id} columnDisplayName="${candidate.displayName}" confirmedByUserId=${confirmedByUserId} ` +
          `durationMs=${Date.now() - startedAt} correlationId=${correlationId}`,
      );

      return this.toMappingResponse(context, mapping);
    } catch (error) {
      const errorType = error instanceof Error ? error.constructor.name : typeof error;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `ReviewDateConfirm failed organizationId=${organizationId} siteId=${siteId} graphListId=${graphListId} ` +
          `confirmedByUserId=${confirmedByUserId} errorType=${errorType} durationMs=${Date.now() - startedAt} ` +
          `correlationId=${correlationId}: ${message}`,
      );
      throw error;
    }
  }

  async checkReviewDateEligibility(
    organizationId: string,
    siteId: string,
    graphListId: string,
  ): Promise<ReviewDateEligibilityResponse> {
    const context = createTenantContext(organizationId);
    const { candidates } = await this.resolveDiscoveredCandidates(context, siteId, graphListId);

    if (candidates.length === 0) return { status: 'NoEligibleColumn' };
    if (candidates.length === 1) {
      const [column] = candidates;
      return { status: 'SingleEligibleColumn', column: toEligibilityColumn(column!) };
    }
    return { status: 'MultipleEligibleColumns', columns: candidates.map(toEligibilityColumn) };
  }

  /**
   * Phase 2: enumerates a site's document libraries with whatever mapping
   * state already exists in our own DB — deliberately does NOT run live
   * column discovery for every library (that's 2 Graph calls per library;
   * for a site with dozens of libraries, prefetching eligibility for all
   * of them on every page load would be exactly the unbounded Graph load
   * Phase 1.2's eligibility-endpoint review warned against). Eligibility
   * for an unmapped library stays a separate, lazy, per-library call the
   * caller makes on demand — this endpoint only ever makes the one
   * listDrives sweep needed to enumerate libraries at all, which nothing
   * else in this app currently exposes to apps/api.
   */
  async listReviewDateLibraries(organizationId: string, siteId: string): Promise<ReviewDateLibraryResponse[]> {
    const context = createTenantContext(organizationId);

    const site = await context.sharePointSites.findFirstById(siteId);
    if (!site) throw new NotFoundException('SharePoint site not found');

    const tenant = await context.microsoftTenants.findFirstById(site.microsoftTenantId);
    if (!tenant) throw new NotFoundException('Microsoft tenant not found');

    let drives;
    try {
      drives = await collectAsync(listDrives(tenant.entraTenantId, site.graphSiteId, { correlationId: randomUUID() }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(`Failed to read SharePoint document libraries: ${message}`);
    }

    const mappings = await context.sharePointReviewDateMappings.findManyBySite(siteId);
    const mappingByListId = new Map(mappings.map((mapping) => [mapping.graphListId, mapping]));

    const libraries: ReviewDateLibraryResponse[] = [];
    for (const drive of drives) {
      const graphListId = drive.list?.id;
      if (!graphListId) continue; // not every drive has an associated list — skip non-library drives

      const mapping = mappingByListId.get(graphListId);
      libraries.push({
        graphListId,
        driveId: drive.id,
        name: drive.name,
        mapping: mapping ? await this.toMappingResponse(context, mapping) : null,
      });
    }
    return libraries;
  }

  // ---------------------------------------------------------------------
  // ADR-0025: Taxonomy classification-field configuration. Mirrors the
  // review-date confirm/list flow above; the key differences are that
  // candidates are ALL non-hidden columns (no heuristic filter — the admin
  // designates their own scheme), a library may have multiple designated
  // fields, and removal is a real delete rather than a status flip.
  // ---------------------------------------------------------------------

  async listClassificationCandidates(
    organizationId: string,
    siteId: string,
    graphListId: string,
  ): Promise<ClassificationCandidateColumn[]> {
    const context = createTenantContext(organizationId);
    const columns = await this.resolveLibraryColumns(context, siteId, graphListId);
    return columns.map((column) => ({ id: column.id, name: column.name, displayName: column.displayName }));
  }

  async listClassificationLibraries(organizationId: string, siteId: string): Promise<ClassificationLibraryResponse[]> {
    const context = createTenantContext(organizationId);

    const site = await context.sharePointSites.findFirstById(siteId);
    if (!site) throw new NotFoundException('SharePoint site not found');

    const tenant = await context.microsoftTenants.findFirstById(site.microsoftTenantId);
    if (!tenant) throw new NotFoundException('Microsoft tenant not found');

    let drives;
    try {
      drives = await collectAsync(listDrives(tenant.entraTenantId, site.graphSiteId, { correlationId: randomUUID() }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(`Failed to read SharePoint document libraries: ${message}`);
    }

    const fields = await context.sharePointClassificationFields.findManyBySite(siteId);
    const fieldsByListId = new Map<string, SharePointClassificationField[]>();
    for (const field of fields) {
      const list = fieldsByListId.get(field.graphListId) ?? [];
      list.push(field);
      fieldsByListId.set(field.graphListId, list);
    }

    const libraries: ClassificationLibraryResponse[] = [];
    for (const drive of drives) {
      const graphListId = drive.list?.id;
      if (!graphListId) continue;
      const libraryFields = fieldsByListId.get(graphListId) ?? [];
      libraries.push({
        graphListId,
        driveId: drive.id,
        name: drive.name,
        fields: await Promise.all(libraryFields.map((field) => this.toClassificationFieldResponse(context, field))),
      });
    }
    return libraries;
  }

  async designateClassificationField(
    organizationId: string,
    siteId: string,
    graphListId: string,
    columnDefinitionId: string,
    confirmedByUserId: string,
  ): Promise<ClassificationFieldResponse> {
    const context = createTenantContext(organizationId);

    // Re-validate the selection against the CURRENT live columns — never
    // trust a client-remembered id — so the stored display-name snapshot is
    // accurate and a vanished column can't be designated.
    const columns = await this.resolveLibraryColumns(context, siteId, graphListId);
    const column = columns.find((candidate) => candidate.id === columnDefinitionId);
    if (!column) {
      throw new BadRequestException('The selected column is not a valid column for this library.');
    }

    const field = await context.sharePointClassificationFields.upsertActive({
      siteId,
      graphListId,
      columnDefinitionId: column.id,
      columnDisplayNameAtConfirmation: column.displayName,
      confirmedByUserId,
    });

    this.logger.log(
      `ClassificationFieldDesignate succeeded organizationId=${organizationId} siteId=${siteId} graphListId=${graphListId} ` +
        `columnDefinitionId=${column.id} columnDisplayName="${column.displayName}" confirmedByUserId=${confirmedByUserId}`,
    );

    return this.toClassificationFieldResponse(context, field);
  }

  async removeClassificationField(organizationId: string, siteId: string, fieldId: string): Promise<void> {
    const context = createTenantContext(organizationId);

    // Enforce site ownership as well as tenant scoping: the field must
    // belong to this org (deleteById is org-scoped) AND to the site in the
    // route, so a field can't be removed via another site's URL.
    const siteFields = await context.sharePointClassificationFields.findManyBySite(siteId);
    if (!siteFields.some((field) => field.id === fieldId)) {
      throw new NotFoundException('Classification field not found for this site.');
    }

    const deleted = await context.sharePointClassificationFields.deleteById(fieldId);
    if (!deleted) throw new NotFoundException('Classification field not found.');
  }

  private async toClassificationFieldResponse(
    context: ReturnType<typeof createTenantContext>,
    field: SharePointClassificationField,
  ): Promise<ClassificationFieldResponse> {
    const confirmedByUser = await context.users.findFirstById(field.confirmedByUserId);
    return {
      id: field.id,
      siteId: field.siteId,
      graphListId: field.graphListId,
      columnDefinitionId: field.columnDefinitionId,
      columnDisplayName: field.columnDisplayNameAtConfirmation,
      status: field.status,
      staleDetectedAt: field.staleDetectedAt?.toISOString() ?? null,
      confirmedByUserId: field.confirmedByUserId,
      confirmedByDisplayName: confirmedByUser?.displayName ?? null,
      confirmedAt: field.confirmedAt.toISOString(),
    };
  }

  // All non-hidden columns for a library (site + list columns merged,
  // deduped by stable id). Unlike resolveDiscoveredCandidates, applies no
  // review-date heuristic — classification columns are whatever the admin
  // designates.
  private async resolveLibraryColumns(
    context: ReturnType<typeof createTenantContext>,
    siteId: string,
    graphListId: string,
    correlationId: string = randomUUID(),
  ): Promise<GraphColumnDefinition[]> {
    const site = await context.sharePointSites.findFirstById(siteId);
    if (!site) throw new NotFoundException('SharePoint site not found');

    const tenant = await context.microsoftTenants.findFirstById(site.microsoftTenantId);
    if (!tenant) throw new NotFoundException('Microsoft tenant not found');

    const graphOptions = { correlationId };
    let listColumnsResult: GraphColumnDefinition[];
    let contentTypeColumns: GraphColumnDefinition[];
    try {
      listColumnsResult = await collectAsync(listColumns(tenant.entraTenantId, site.graphSiteId, graphListId, graphOptions));
      const contentTypes = await collectAsync(listContentTypes(tenant.entraTenantId, site.graphSiteId, graphListId, graphOptions));
      contentTypeColumns = contentTypes.flatMap((contentType) => contentType.columns ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(`Failed to read SharePoint column metadata: ${message}`);
    }

    const byId = new Map<string, GraphColumnDefinition>();
    for (const column of [...listColumnsResult, ...contentTypeColumns]) {
      if (column.hidden === true) continue;
      if (!byId.has(column.id)) byId.set(column.id, column);
    }
    return [...byId.values()];
  }

  // Structural, never a guess: 0 candidates is always an error regardless
  // of selection; exactly 1 candidate is used directly (a selection, if
  // provided, must match it — a stale/wrong selection is rejected, never
  // silently ignored); 2+ candidates require a selection that matches one
  // of the *current* live candidates — never the caller's remembered list
  // from an earlier eligibility check, which could be stale by now.
  private selectConfirmCandidate(
    candidates: GraphColumnDefinition[],
    selectedColumnDefinitionId: string | undefined,
  ): GraphColumnDefinition {
    if (candidates.length === 0) {
      throw new BadRequestException('No date column was found for this library — nothing to confirm.');
    }

    if (candidates.length === 1) {
      const [only] = candidates;
      if (selectedColumnDefinitionId && selectedColumnDefinitionId !== only!.id) {
        throw new BadRequestException('The selected column is no longer a valid candidate for this library.');
      }
      return only!;
    }

    if (!selectedColumnDefinitionId) {
      const names = candidates.map((candidate) => candidate.displayName).join(', ');
      throw new ConflictException(
        `Multiple candidate date columns were found for this library (${names}) — a columnDefinitionId selection is required.`,
      );
    }

    const selected = candidates.find((candidate) => candidate.id === selectedColumnDefinitionId);
    if (!selected) {
      throw new BadRequestException('The selected column is no longer a valid candidate for this library.');
    }
    return selected;
  }

  private async toMappingResponse(
    context: ReturnType<typeof createTenantContext>,
    mapping: SharePointReviewDateMapping,
  ): Promise<ReviewDateMappingResponse> {
    const confirmedByUser = await context.users.findFirstById(mapping.confirmedByUserId);
    return {
      id: mapping.id,
      siteId: mapping.siteId,
      graphListId: mapping.graphListId,
      columnDefinitionId: mapping.columnDefinitionId,
      columnDisplayName: mapping.columnDisplayNameAtConfirmation,
      status: mapping.status,
      confirmedByUserId: mapping.confirmedByUserId,
      confirmedByDisplayName: confirmedByUser?.displayName ?? null,
      confirmedAt: mapping.confirmedAt.toISOString(),
    };
  }

  private async resolveDiscoveredCandidates(
    context: ReturnType<typeof createTenantContext>,
    siteId: string,
    graphListId: string,
    correlationId: string = randomUUID(),
  ): Promise<{ candidates: GraphColumnDefinition[] }> {
    const site = await context.sharePointSites.findFirstById(siteId);
    if (!site) throw new NotFoundException('SharePoint site not found');

    const tenant = await context.microsoftTenants.findFirstById(site.microsoftTenantId);
    if (!tenant) throw new NotFoundException('Microsoft tenant not found');

    const graphOptions = { correlationId };

    let listColumnsResult: GraphColumnDefinition[];
    let contentTypeColumnsResult: GraphColumnDefinition[];
    try {
      listColumnsResult = await collectAsync(listColumns(tenant.entraTenantId, site.graphSiteId, graphListId, graphOptions));
      const contentTypes = await collectAsync(
        listContentTypes(tenant.entraTenantId, site.graphSiteId, graphListId, graphOptions),
      );
      contentTypeColumnsResult = contentTypes.flatMap((contentType) => contentType.columns ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(`Failed to read SharePoint column metadata: ${message}`);
    }

    return { candidates: resolveReviewDateCandidates(listColumnsResult, contentTypeColumnsResult) };
  }
}
