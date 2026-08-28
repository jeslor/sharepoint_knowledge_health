import type { HealthIssueCriterion } from '@prisma/client';
import { createTenantContext } from './tenant-context';

export interface ResolveGovernanceIssueForRemediationInput {
  organizationId: string;
  documentId: string;
  issueType: HealthIssueCriterion;
  actorUserId: string;
}

export interface ResolveGovernanceIssueForRemediationResult {
  resolved: boolean;
}

/**
 * ADR-0022 §13.2: the narrow, explicit exception to ADR-0016's
 * human-facing state machine — allows an automated remediation pipeline
 * (apps/worker) to transition an Open or InProgress GovernanceIssue
 * directly to Resolved, which GovernanceIssuesService.updateIssue's
 * ALLOWED_TRANSITIONS map (apps/api, unchanged by this function) does not
 * permit for the HTTP-facing, human-driven path. This function does NOT
 * decide *whether* resolution is warranted — that determination (write
 * verified, rescoring confirms the criterion's HealthIssue is gone) is
 * entirely the caller's responsibility (apps/worker's remediation
 * processor). This function's own job is narrower: given that the caller
 * has already decided resolution is warranted,
 *  (1) validate a real actor is present (ADR-0022 §13.2's third
 *      precondition, checked explicitly here even though
 *      RemediationJob.initiatedByUserId is already a required,
 *      non-nullable column — a defensive check matching how seriously
 *      this precondition is treated, not just an assumed schema
 *      guarantee),
 *  (2) find the (documentId, issueType) governance thread (ADR-0016's
 *      own @@unique constraint — at most one row can ever match),
 *  (3) perform the transition + write exactly one GovernanceActivity row,
 *      atomically and idempotently (resolveIfOpenOrInProgress's
 *      conditioned update) so a concurrent/duplicate call never produces
 *      a duplicate audit event.
 *
 * Scoped through createTenantContext(organizationId) like every other
 * write in this system — tenant isolation is never bypassed, even though
 * there is no HTTP request/guard chain on this code path (authorization
 * already happened once, at RemediationJob creation time — ADR-0022 §8).
 */
export async function resolveGovernanceIssueForRemediation(
  input: ResolveGovernanceIssueForRemediationInput,
): Promise<ResolveGovernanceIssueForRemediationResult> {
  if (!input.actorUserId) {
    throw new Error('resolveGovernanceIssueForRemediation requires a real actorUserId — refusing to resolve without one');
  }

  const context = createTenantContext(input.organizationId);

  const [governanceIssue] = await context.governanceIssues.findMany({
    where: { documentId: input.documentId, issueType: input.issueType },
    take: 1,
  });
  if (!governanceIssue) {
    // Nothing tracked for this (documentId, issueType) — e.g. no human
    // ever opened a GovernanceIssue for it. The underlying data was still
    // fixed by the remediation; there is simply nothing to resolve here,
    // matching ADR-0016's "GovernanceIssue is opt-in tracking" design.
    return { resolved: false };
  }

  const previousStatus = governanceIssue.status;
  const { advanced } = await context.governanceIssues.resolveIfOpenOrInProgress(governanceIssue.id, { resolvedAt: new Date() });
  if (!advanced) {
    // Already Resolved, or a concurrent/duplicate call already won this
    // exact transition — idempotent no-op, no second audit event.
    return { resolved: false };
  }

  await context.governanceActivity.create({
    governanceIssueId: governanceIssue.id,
    documentId: input.documentId,
    actorUserId: input.actorUserId,
    activityType: 'IssueResolved',
    previousValue: previousStatus,
    newValue: 'Resolved',
  });

  return { resolved: true };
}
