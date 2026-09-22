import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from './client';

// Accepts either the shared singleton or an in-flight transaction client —
// mirrors onboarding.ts's/remediation.ts's own `prisma.$transaction(async
// (tx) => ...)` shape, using the raw client directly rather than a
// tenant-scoped repository (repositories aren't transaction-aware; see
// remediation.ts's createRemediationJobWithItems for the exact precedent
// this file follows).
export type EntitlementDbClient = PrismaClient | Prisma.TransactionClient;

export interface DocumentSlotResult {
  success: boolean;
  currentDocumentCount: number;
  documentLimit: number;
}

// Every organization must have an OrganizationEntitlement row after the
// backfill migration (backfill-organization-entitlements.ts) and every new
// organization gets one at bootstrap (onboarding.ts's
// provisionOrganizationFromConsent). A missing row here means that
// invariant was violated somewhere upstream — fail closed (throw) rather
// than silently allow unlimited documents or silently fabricate a default
// entitlement, matching TenantContextGuard's own "fail closed, never
// silently provision fallback state" posture.
export class NoEntitlementError extends Error {
  constructor(organizationId: string) {
    super(
      `No OrganizationEntitlement row exists for organization ${organizationId}. Every organization must have one — see backfill-organization-entitlements.ts and onboarding.ts's provisionOrganizationFromConsent.`,
    );
    this.name = 'NoEntitlementError';
  }
}

/**
 * Atomically reserves one document slot for `organizationId` — the
 * database-level equivalent of:
 *
 *   if currentDocumentCount < documentLimit:
 *       currentDocumentCount += 1
 *       return success
 *   else:
 *       return limit reached
 *
 * ...as a single conditional UPDATE, never a separate
 * read-then-compare-then-write. Postgres serializes concurrent UPDATEs
 * against the same row: whichever transaction's UPDATE commits first
 * advances the counter, and any other transaction's UPDATE (whether it
 * started before or after) only ever evaluates its own WHERE clause
 * against that already-committed value once it's unblocked — there is no
 * window in which two concurrent callers can both observe "one slot left"
 * and both successfully claim it. This is the specific guarantee the
 * architecture evaluation (2026-09-21) required before any worker/API
 * integration: "the implementation must ensure that concurrent callers
 * cannot both successfully consume the same final slot."
 *
 * Caller contract: call this only when about to create a genuinely new
 * Document row (no existing row for this (siteId, graphItemId)) — never for
 * an update/rescan of an existing document, which must never consume a
 * slot. Pass `client` as the same `Prisma.TransactionClient` the caller is
 * about to create the Document row with, so the reservation and the
 * Document creation commit or roll back together (Part 5 of the
 * architecture evaluation: "the usage counter must not become permanently
 * incorrect if the document creation fails"). Omitting `client` runs this
 * as its own standalone statement — still atomic on its own, just not
 * joined to a larger unit of work. See document-lifecycle.ts's
 * createDocumentWithQuota for the actual worker-integration caller (Phase
 * 3), which does exactly this.
 */
export async function tryConsumeDocumentSlot(organizationId: string, client: EntitlementDbClient = prisma): Promise<DocumentSlotResult> {
  const rows = await client.$queryRaw<{ currentDocumentCount: number; documentLimit: number }[]>`
    UPDATE "OrganizationEntitlement"
    SET "currentDocumentCount" = "currentDocumentCount" + 1, "updatedAt" = now()
    WHERE "organizationId" = ${organizationId} AND "currentDocumentCount" < "documentLimit"
    RETURNING "currentDocumentCount", "documentLimit"
  `;

  if (rows.length > 0) {
    const [row] = rows;
    return { success: true, currentDocumentCount: row!.currentDocumentCount, documentLimit: row!.documentLimit };
  }

  // Zero rows back from the conditional UPDATE means either the limit is
  // already reached (the common case) or the row doesn't exist at all
  // (an invariant violation) — a second, cheap read distinguishes the two
  // so the caller gets an accurate signal either way.
  const existing = await client.organizationEntitlement.findUnique({ where: { organizationId } });
  if (!existing) throw new NoEntitlementError(organizationId);

  return { success: false, currentDocumentCount: existing.currentDocumentCount, documentLimit: existing.documentLimit };
}

/**
 * Releases one previously-consumed document slot — the counterpart to
 * tryConsumeDocumentSlot, intended for when a document transitions from
 * Active to Removed. Atomic and floor-clamped at 0 (GREATEST(...,0)):
 * the counter must never go negative even if this were ever called more
 * times than slots were genuinely consumed.
 *
 * Wired into apps/worker's reconcileRemovedDocuments (Phase 3) via
 * document-lifecycle.ts's markDocumentRemovedAndReleaseSlot, which pairs
 * this with the Document's Active -> Removed transition in the same
 * transaction — reconcileRemovedDocuments still processes removed
 * documents one at a time in a loop (preserving its existing per-document
 * notification failure isolation), but each iteration's status update and
 * slot release now commit or roll back together.
 */
export async function releaseDocumentSlot(organizationId: string, client: EntitlementDbClient = prisma): Promise<DocumentSlotResult> {
  const rows = await client.$queryRaw<{ currentDocumentCount: number; documentLimit: number }[]>`
    UPDATE "OrganizationEntitlement"
    SET "currentDocumentCount" = GREATEST("currentDocumentCount" - 1, 0), "updatedAt" = now()
    WHERE "organizationId" = ${organizationId}
    RETURNING "currentDocumentCount", "documentLimit"
  `;

  if (rows.length === 0) throw new NoEntitlementError(organizationId);
  const [row] = rows;
  return { success: true, currentDocumentCount: row!.currentDocumentCount, documentLimit: row!.documentLimit };
}
