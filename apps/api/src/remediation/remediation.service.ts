import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  createRemediationJobWithItems,
  createTenantContext,
  type RemediationItem,
  type RemediationJob,
  type TenantContext,
  type UserRole,
} from '@sph/database';
import {
  REMEDIATION_QUEUE,
  type CreateRemediationJobRequest,
  type CreateRemediationJobResponse,
  type PaginatedResponse,
  type RemediationItemResult,
  type RemediationJobDetailResponse,
  type RemediationJobListQuery,
  type RemediationJobPayload,
  type RemediationJobSummary,
} from '@sph/types';
import { withTimeout } from '../common/with-timeout';
import { AuditLogService } from '../audit-log/audit-log.service';

const MAX_DOCUMENT_IDS = 500;
const DEFAULT_PAGE_SIZE = 25;

// Same rationale as scans.service.ts's SCAN_ENQUEUE_TIMEOUT_MS — ioredis's
// maxRetriesPerRequest is a periodic, connection-wide retry counter, not a
// per-command bound, so this explicit timeout is what actually bounds
// queue.add() deterministically.
const REMEDIATION_ENQUEUE_TIMEOUT_MS = 10_000;

interface EligibilityResult {
  eligibleDocumentIds: string[];
  ineligibleDocumentIds: string[];
}

/**
 * ADR-0022 §6/§8, Phase 6: "POST /remediation-jobs re-validates every
 * document server-side, creates the job+items atomically, then enqueues
 * it — never trusting the client-supplied documentId list blindly."
 * Mirrors ScansService.triggerScan's exact create-then-enqueue-with-timeout
 * shape, including its enqueue-failure handling — see createRemediationJob's
 * own comment for the one structural difference (RemediationJobStatus has
 * no Failed value).
 */
@Injectable()
export class RemediationService {
  constructor(
    @InjectQueue(REMEDIATION_QUEUE) private readonly remediationQueue: Queue<RemediationJobPayload>,
    private readonly auditLog: AuditLogService,
  ) {}

  async createRemediationJob(
    organizationId: string,
    actorUserId: string,
    actorRole: UserRole,
    request: CreateRemediationJobRequest,
  ): Promise<CreateRemediationJobResponse> {
    const context = createTenantContext(organizationId);

    if (!request?.issueType) {
      throw new BadRequestException('issueType is required');
    }
    const nextReviewDueAt = this.parseReviewDate(request.nextReviewDueAt);

    const rawDocumentIds = request.documentIds ?? [];
    if (rawDocumentIds.length === 0) {
      throw new BadRequestException('documentIds must not be empty');
    }

    // ADR-0022 §7: dedupe BEFORE any DB write — otherwise two identical ids
    // would both survive eligibility checking below and collide on
    // RemediationItem's (remediationJobId, documentId) unique constraint
    // mid-transaction instead of failing cleanly here.
    const dedupedDocumentIds = [...new Set(rawDocumentIds)];
    if (dedupedDocumentIds.length > MAX_DOCUMENT_IDS) {
      throw new BadRequestException(`documentIds must not exceed ${MAX_DOCUMENT_IDS} documents per job`);
    }

    const { eligibleDocumentIds, ineligibleDocumentIds } = await this.resolveEligibility(
      context,
      dedupedDocumentIds,
      request.issueType,
    );

    if (eligibleDocumentIds.length === 0) {
      throw new BadRequestException('None of the submitted documents are eligible for remediation');
    }

    const job = await createRemediationJobWithItems({
      organizationId,
      issueType: request.issueType,
      payload: { nextReviewDueAt },
      initiatedByUserId: actorUserId,
      initiatedByRole: actorRole,
      documentIds: eligibleDocumentIds,
    });

    try {
      await withTimeout(
        this.remediationQueue.add('remediate', { organizationId, remediationJobId: job.id }),
        REMEDIATION_ENQUEUE_TIMEOUT_MS,
        'Redis enqueue timed out',
      );
    } catch (enqueueError) {
      // P0-2 (locked decision, Option A): do NOT add a Failed
      // RemediationJobStatus and do NOT add a migration. Unlike
      // scans.service.ts's compensating write (flip the ScanJob itself to
      // Failed), RemediationJobStatus only has Running/Completed — so the
      // compensating action here reuses RemediationItem's existing Skipped
      // status (with errorType 'EnqueueFailed') per item, then marks the
      // job itself Completed. Same "compensating write, not a transaction —
      // Postgres and Redis are separate systems" precedent, adapted to
      // this schema's actual shape. The job must never remain permanently
      // Running because of an enqueue failure.
      const message = enqueueError instanceof Error ? enqueueError.message : String(enqueueError);
      try {
        await context.remediationItems.markSkippedForJob(job.id, {
          errorType: 'EnqueueFailed',
          errorMessage: `Failed to enqueue remediation job: ${message}`,
        });
        await context.remediationJobs.updateById(job.id, {
          status: 'Completed',
          completedAt: new Date(),
        });
      } catch {
        // Compensating write itself failed (e.g. Postgres also unavailable)
        // — do not mask the original enqueue error with this one (same
        // precedent as scans.service.ts).
      }
      throw enqueueError;
    }

    // Recorded only once the job is genuinely enqueued — an enqueue
    // failure above rethrows before reaching this line, so a failed
    // creation attempt never produces an audit record (same precedent as
    // scans.service.ts's own comment). Uses the exact action name this
    // codebase already pre-declared for this purpose
    // (packages/types/src/api/audit-log.ts's 'remediation_job.initiated',
    // not 'remediation_job.created' — see the implementation summary for
    // why the pre-existing, ADR-0022-§3.6-referenced value was kept
    // instead of introducing a second, unused action name).
    await this.auditLog.record(organizationId, {
      actorUserId,
      action: 'remediation_job.initiated',
      targetType: 'RemediationJob',
      targetId: job.id,
    });

    return {
      remediationJobId: job.id,
      totalCount: job.totalCount,
      ineligibleDocumentIds,
    };
  }

  /**
   * P0-3: the bulk-remediation history list. Mirrors AuditLogService.list's
   * exact shape (page/pageSize, findMany+count in parallel, batched actor-
   * name enrichment) rather than ScansService.listScans's fixed-take-50,
   * unpaginated convention — this list is expected to grow the same way
   * audit-log's does (one row per job, not per affected document), so it
   * gets the same PaginatedResponse contract from the start.
   */
  async listRemediationJobs(
    organizationId: string,
    query: RemediationJobListQuery,
  ): Promise<PaginatedResponse<RemediationJobSummary>> {
    const context = createTenantContext(organizationId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const [jobs, total] = await Promise.all([
      context.remediationJobs.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      context.remediationJobs.count(),
    ]);

    const data = await this.toSummaries(context, jobs);
    return { data, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  /**
   * P0-3: the bulk-remediation progress/detail view. findFirstById is
   * tenant-scoped by construction (RemediationJobRepository), so a jobId
   * belonging to another organization is indistinguishable from one that
   * doesn't exist — same 404 behavior as ScansService.getScan, never a
   * cross-organization leak.
   */
  async getRemediationJob(organizationId: string, remediationJobId: string): Promise<RemediationJobDetailResponse> {
    const context = createTenantContext(organizationId);

    const job = await context.remediationJobs.findFirstById(remediationJobId);
    if (!job) throw new NotFoundException('Remediation job not found');

    const items = await context.remediationItems.findMany({ where: { remediationJobId } });
    const [summary] = await this.toSummaries(context, [job], items);

    return { ...summary!, items: items.map((item) => this.toItemResult(item)) };
  }

  // Same date-format-validation semantics as documents.controller.ts's
  // parseReviewDate, adapted for this endpoint's contract: nextReviewDueAt
  // is a required field here (bulk remediation sets a value; it never
  // clears one), so there is no null branch.
  private parseReviewDate(value: string | undefined): string {
    if (!value) {
      throw new BadRequestException('nextReviewDueAt is required');
    }
    if (Number.isNaN(new Date(value).getTime())) {
      throw new BadRequestException('nextReviewDueAt must be a valid ISO date string');
    }
    return value;
  }

  // Follows the exact eligibility shape already used by
  // governance-issues.service.ts::createIssue — (1) tenant-scoped lookup,
  // (2) currentHealthScoreId must exist, (3) a matching HealthIssue for the
  // requested criterion must currently exist — batched across up to 500
  // documentIds (two queries total, never N+1) instead of one document at a
  // time. Not a second, different definition of eligibility.
  private async resolveEligibility(
    context: TenantContext,
    documentIds: string[],
    issueType: CreateRemediationJobRequest['issueType'],
  ): Promise<EligibilityResult> {
    const documents = await context.documents.findMany({ where: { id: { in: documentIds } } });
    const documentById = new Map(documents.map((document) => [document.id, document]));

    const ineligibleDocumentIds: string[] = [];
    const scoredCandidates: { id: string; currentHealthScoreId: string }[] = [];

    for (const documentId of documentIds) {
      const document = documentById.get(documentId);
      if (!document) {
        // Not found in this organization — includes documentIds belonging
        // to another organization entirely, since context.documents is
        // tenant-scoped by construction (ADR-0001): there is no way for a
        // cross-organization id to resolve here, so it is classified
        // ineligible rather than producing an unhandled error.
        ineligibleDocumentIds.push(documentId);
        continue;
      }
      if (!document.currentHealthScoreId) {
        ineligibleDocumentIds.push(documentId); // not yet scored
        continue;
      }
      scoredCandidates.push({ id: documentId, currentHealthScoreId: document.currentHealthScoreId });
    }

    if (scoredCandidates.length === 0) {
      return { eligibleDocumentIds: [], ineligibleDocumentIds };
    }

    const healthScoreIds = [...new Set(scoredCandidates.map((candidate) => candidate.currentHealthScoreId))];
    const matchingIssues = await context.healthIssues.findMany({
      where: { healthScoreId: { in: healthScoreIds }, criterion: issueType },
    });
    const scoresWithMatchingIssue = new Set(matchingIssues.map((issue) => issue.healthScoreId));

    const eligibleDocumentIds: string[] = [];
    for (const candidate of scoredCandidates) {
      if (scoresWithMatchingIssue.has(candidate.currentHealthScoreId)) {
        eligibleDocumentIds.push(candidate.id);
      } else {
        ineligibleDocumentIds.push(candidate.id); // no currently-detected issue of this type
      }
    }

    return { eligibleDocumentIds, ineligibleDocumentIds };
  }

  // Batched actorUserName lookup, same pattern as AuditLogService.enrich —
  // one query for every distinct initiatedByUserId on the page, never N+1.
  // Accepts either a repository-side groupBy result (list) or the
  // already-loaded item set for a single job (detail) so
  // succeeded/failed/skipped are always derived live from RemediationItem
  // rows, never from RemediationJob.succeededCount/failedCount (only
  // written once, at completion — stale zeros for a still-Running job).
  private async toSummaries(
    context: TenantContext,
    jobs: RemediationJob[],
    presetItems?: RemediationItem[],
  ): Promise<RemediationJobSummary[]> {
    if (jobs.length === 0) return [];

    const actorIds = [...new Set(jobs.map((job) => job.initiatedByUserId))];
    const actors = await context.users.findMany({ where: { id: { in: actorIds } } });
    const actorNameById = new Map(actors.map((user) => [user.id, user.displayName]));

    const countRows = presetItems
      ? presetItems.map((item) => ({ remediationJobId: item.remediationJobId, status: item.status, count: 1 }))
      : await context.remediationItems.groupByStatusForJobs(jobs.map((job) => job.id));
    const countsByJob = this.toCountsMap(countRows);

    return jobs.map((job) => {
      const counts = countsByJob.get(job.id) ?? { succeededCount: 0, failedCount: 0, skippedCount: 0 };
      return {
        id: job.id,
        status: job.status,
        issueType: job.issueType,
        nextReviewDueAt: this.extractNextReviewDueAt(job.payload),
        initiatedByUserId: job.initiatedByUserId,
        initiatedByUserName: actorNameById.get(job.initiatedByUserId) ?? 'Unknown user',
        totalCount: job.totalCount,
        succeededCount: counts.succeededCount,
        failedCount: counts.failedCount,
        skippedCount: counts.skippedCount,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt?.toISOString() ?? null,
      };
    });
  }

  private toCountsMap(
    rows: { remediationJobId: string; status: string; count: number }[],
  ): Map<string, { succeededCount: number; failedCount: number; skippedCount: number }> {
    const counts = new Map<string, { succeededCount: number; failedCount: number; skippedCount: number }>();
    for (const row of rows) {
      const bucket = counts.get(row.remediationJobId) ?? { succeededCount: 0, failedCount: 0, skippedCount: 0 };
      if (row.status === 'Succeeded') bucket.succeededCount += row.count;
      else if (row.status === 'Failed') bucket.failedCount += row.count;
      else if (row.status === 'Skipped') bucket.skippedCount += row.count;
      counts.set(row.remediationJobId, bucket);
    }
    return counts;
  }

  // RemediationJob.payload is stored as Json — same cast-and-narrow shape
  // as RemediationProcessor.parseActionPayload, except this is a read path
  // (a list/detail request must never 500 on a malformed job payload the
  // way the worker's own processing is allowed to fail loudly on), so an
  // unexpected shape returns null instead of throwing.
  private extractNextReviewDueAt(payload: unknown): string | null {
    const raw = (payload as Record<string, unknown> | null)?.nextReviewDueAt;
    return typeof raw === 'string' ? raw : null;
  }

  private toItemResult(item: RemediationItem): RemediationItemResult {
    return {
      documentId: item.documentId,
      status: item.status,
      errorType: item.errorType,
      errorMessage: item.errorMessage,
      attemptCount: item.attemptCount,
    };
  }
}
