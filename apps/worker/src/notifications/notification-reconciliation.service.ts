import { Injectable, Logger } from '@nestjs/common';
import { createTenantContext, type GovernanceIssue, type TenantContext } from '@sph/database';

/**
 * ADR-0021 §3.3: the single, shared reconciliation execution path — called
 * by both the event-driven processor (immediately after a scan completes)
 * and the periodic safety-net sweep (recovering from a missed/failed
 * enqueue). One implementation, two triggers, matching the "Expected
 * model" diagram exactly (both arrows converge on the same mechanism).
 *
 * ADR-0016 §16.1 (amended 2026-08-04): a worker process may READ
 * GovernanceIssue for this purpose, but must NEVER mutate its lifecycle
 * state — this service only ever calls context.governanceIssues.findMany
 * (read) and context.notifications.upsertByDedupeKey (a different entity
 * entirely). There is no updateById/status-changing call anywhere in this
 * file, by design — enforced by never importing or calling one, not just
 * by convention (verified directly in tests).
 *
 * Concurrency correctness (Phase D.2 review fix): reconciliation for the
 * same organization can genuinely run concurrently — an org with more than
 * one connected MicrosoftTenant scanning independently, the event-driven
 * trigger overlapping the hourly sweep, or BullMQ redelivering a scan job
 * can all produce two simultaneous reconcileForOrganization calls for the
 * same org. This method has no lock and needs none: notifications.
 * upsertByDedupeKey resolves the race at the database level (a unique
 * constraint on Notification.dedupeKey), which is simpler and more robust
 * than an application-level lock — Postgres already guarantees exactly one
 * row wins a conflicting upsert; no distributed coordination to build,
 * time out, or deadlock on.
 */
@Injectable()
export class NotificationReconciliationService {
  private readonly logger = new Logger(NotificationReconciliationService.name);

  async reconcileForOrganization(organizationId: string): Promise<void> {
    const context = createTenantContext(organizationId);

    const openIssues = await context.governanceIssues.findMany({
      where: { status: { in: ['Open', 'InProgress'] } },
    });
    if (openIssues.length === 0) return;

    const stillDetectedById = await this.computeStillDetected(context, openIssues);

    let candidates = 0;
    for (const issue of openIssues) {
      if (stillDetectedById.get(issue.id) !== false) continue; // still detected, or undeterminable — nothing to suggest
      if (!issue.assignedUserId) continue; // no resolvable recipient (ADR-0021 §3.2)

      // Keyed on (issue, generation) — issue.updatedAt changes on every
      // reopen, so a genuine re-suggestion after a reopen-and-refix cycle
      // always gets a fresh key (never blocked); two concurrent runs
      // evaluating the SAME generation compute the SAME key and collide
      // on the same DB row, so only one notification ever results.
      await context.notifications.upsertByDedupeKey({
        dedupeKey: `${issue.id}:${issue.updatedAt.getTime()}`,
        userId: issue.assignedUserId,
        type: 'ResolutionSuggested',
        message: `A rescan no longer detects this ${issue.issueType} issue — confirm and resolve?`,
        governanceIssueId: issue.id,
        documentId: issue.documentId,
      });
      candidates += 1;
    }

    if (candidates > 0) {
      // "Considered", not "created" — upsertByDedupeKey may have resolved
      // to a no-op if a concurrent run (or an earlier attempt for this
      // exact issue generation) already won the race.
      this.logger.log(`Reconciliation for org ${organizationId}: ${candidates} ResolutionSuggested notification(s) considered.`);
    }
  }

  // Same (healthScoreId, criterion) key-matching logic as
  // apps/api/src/governance/governance-issues.service.ts's enrichIssues —
  // deliberately mirrored, not re-derived differently, since any drift
  // between the two computations would be a real correctness bug (the API
  // and the reconciliation job must agree on what "still detected" means).
  private async computeStillDetected(
    context: TenantContext,
    issues: GovernanceIssue[],
  ): Promise<Map<string, boolean>> {
    const documentIds = [...new Set(issues.map((issue) => issue.documentId))];
    const documents = await context.documents.findMany({ where: { id: { in: documentIds } } });
    const documentById = new Map(documents.map((document) => [document.id, document]));

    const healthScoreIds = documents
      .map((document) => document.currentHealthScoreId)
      .filter((id): id is string => id !== null);
    const currentHealthIssues =
      healthScoreIds.length > 0
        ? await context.healthIssues.findMany({ where: { healthScoreId: { in: healthScoreIds } } })
        : [];
    const detectedKeySet = new Set(currentHealthIssues.map((issue) => `${issue.healthScoreId}:${issue.criterion}`));

    const result = new Map<string, boolean>();
    for (const issue of issues) {
      const document = documentById.get(issue.documentId);
      const stillDetected = document?.currentHealthScoreId
        ? detectedKeySet.has(`${document.currentHealthScoreId}:${issue.issueType}`)
        : false;
      result.set(issue.id, stillDetected);
    }
    return result;
  }
}
