import type { HealthIssueCriterion, RemediationItem, RemediationJob, UserRole } from '@prisma/client';
import { prisma } from './client';

export interface CreateRemediationJobInput {
  organizationId: string;
  issueType: HealthIssueCriterion;
  payload: Record<string, unknown>;
  initiatedByUserId: string;
  initiatedByRole: UserRole;
  documentIds: string[];
}

export interface RemediationJobWithItems extends RemediationJob {
  items: RemediationItem[];
}

/**
 * ADR-0022 §8: "create the job and items atomically where appropriate" —
 * mirrors onboarding.ts's provisionOrganizationFromConsent transaction
 * shape exactly (a single prisma.$transaction using the raw tx client
 * directly, not the tenant-scoped repository classes, which aren't
 * transaction-aware). `documentIds` must already be validated by the
 * caller as belonging to this organization and eligible for remediation
 * (ADR-0022 §8's server-side re-validation requirement, an API-layer
 * concern, Phase 6) — this function trusts its input completely and
 * performs no re-validation of its own; it is a pure persistence
 * operation, not a business-rule boundary.
 */
export async function createRemediationJobWithItems(input: CreateRemediationJobInput): Promise<RemediationJobWithItems> {
  return prisma.$transaction(async (tx) => {
    const job = await tx.remediationJob.create({
      data: {
        organizationId: input.organizationId,
        issueType: input.issueType,
        // Prisma's generated JSON input type doesn't structurally accept a
        // plain Record — this cast is the standard, documented workaround
        // already used by AuditLogService.record/GovernanceActivityService.record.
        payload: input.payload as object,
        initiatedByUserId: input.initiatedByUserId,
        initiatedByRole: input.initiatedByRole,
        totalCount: input.documentIds.length,
      },
    });

    await tx.remediationItem.createMany({
      data: input.documentIds.map((documentId) => ({
        organizationId: input.organizationId,
        remediationJobId: job.id,
        documentId,
      })),
    });

    const items = await tx.remediationItem.findMany({ where: { remediationJobId: job.id } });
    return { ...job, items };
  });
}
