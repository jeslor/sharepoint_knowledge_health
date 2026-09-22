import type { Document } from '@prisma/client';
import { prisma } from './client';
import { tryConsumeDocumentSlot, releaseDocumentSlot } from './entitlement';

export interface CreateDocumentWithQuotaInput {
  organizationId: string;
  siteId: string;
  graphItemId: string;
  name: string;
  path: string;
  fileType: string;
  webUrl: string | null;
  sizeBytes: bigint;
  sourceCreatedAt: Date;
  sourceModifiedAt: Date;
  graphListId?: string;
}

export type CreateDocumentWithQuotaResult =
  | { outcome: 'created'; document: Document }
  | { outcome: 'limitReached'; currentDocumentCount: number; documentLimit: number };

/**
 * Creates a genuinely new Document row, gated by the organization's
 * entitlement — the worker-integration counterpart the Phase 1/2
 * architecture evaluation and entitlement.ts's own module comment both
 * anticipated: "design the service/API so the eventual worker integration
 * can perform the quota increment and document creation safely within the
 * appropriate database transaction." Mirrors onboarding.ts's
 * provisionOrganizationFromConsent / remediation.ts's
 * createRemediationJobWithItems exactly — a single prisma.$transaction
 * using the raw tx client directly, not DocumentRepository (which, like
 * every tenant-scoped repository, is bound to the plain PrismaClient
 * singleton, not a Prisma.TransactionClient, so it cannot participate in
 * this transaction — see remediation.ts's own comment for the same
 * precedent this follows).
 *
 * The reservation and the Document row commit or roll back together: if
 * tryConsumeDocumentSlot fails (limit reached), no Document is created —
 * the transaction has nothing left to do and simply returns the signal. If
 * the Document creation itself fails (e.g. a unique constraint violation
 * on (siteId, graphItemId) from a concurrent duplicate attempt), the whole
 * transaction rolls back, including the slot reservation — the counter is
 * never left incremented for a document that doesn't exist.
 *
 * Caller contract: only call this for a genuinely new document (the
 * caller has already checked no existing Document row matches this
 * (siteId, graphItemId) — see document-collector.processor.ts's
 * upsertDocument). Never call this for an update/rescan.
 */
export async function createDocumentWithQuota(input: CreateDocumentWithQuotaInput): Promise<CreateDocumentWithQuotaResult> {
  const { organizationId, ...documentData } = input;

  return prisma.$transaction(async (tx) => {
    const reservation = await tryConsumeDocumentSlot(organizationId, tx);
    if (!reservation.success) {
      return { outcome: 'limitReached', currentDocumentCount: reservation.currentDocumentCount, documentLimit: reservation.documentLimit };
    }

    const document = await tx.document.create({
      data: { ...documentData, organizationId, status: 'Active' },
    });

    return { outcome: 'created', document };
  });
}

export interface MarkDocumentRemovedResult {
  document: Document;
  // false when the document was already Removed (or otherwise didn't
  // transition) — the caller must skip any "just removed" side effect
  // (e.g. the assignee notification) in that case, since nothing new
  // actually happened.
  released: boolean;
}

/**
 * Transitions a Document from Active to Removed and releases its
 * entitlement slot, atomically — the release counterpart to
 * createDocumentWithQuota above, for
 * document-collector.processor.ts's reconcileRemovedDocuments.
 *
 * The `status: 'Active'` guard in the conditional update is what makes
 * this safe to call more than once for the same document (idempotent,
 * exactly-once release): a second call against an already-Removed
 * document matches zero rows, so releaseDocumentSlot is never reached and
 * `released: false` is returned — this is the same atomic
 * conditional-update discipline tryConsumeDocumentSlot itself uses to
 * prevent a race, applied here to prevent a double release instead of a
 * double consume. It's also what protects against the (currently unlikely
 * but architecturally possible) case of two concurrent workers both
 * reconciling the same document: whichever transaction's UPDATE commits
 * first wins the transition; the other's WHERE clause then matches zero
 * rows against the already-Removed row and safely no-ops.
 *
 * organizationId scopes both the Document lookup and the entitlement
 * release, matching every other tenant-scoped write in this codebase — a
 * documentId that doesn't belong to organizationId simply matches nothing
 * and is treated as "no transition happened," never releases another
 * organization's slot. Mirrors DocumentRepository.updateById's own
 * `Document | null` convention for "not found under this tenant scope":
 * returns null rather than throwing when no document with this id exists
 * for this organizationId at all (wrong org, or a genuinely bad id).
 *
 * Deliberately a single, self-contained per-document transaction, not a
 * bulk operation across every removed document in a site — this
 * preserves reconcileRemovedDocuments' existing per-document failure
 * isolation exactly (today, one document's notification failure doesn't
 * affect any other document in the same reconciliation pass; wrapping the
 * whole loop in one transaction would silently change that).
 */
export async function markDocumentRemovedAndReleaseSlot(
  organizationId: string,
  documentId: string,
): Promise<MarkDocumentRemovedResult | null> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.document.updateMany({
      where: { id: documentId, organizationId, status: 'Active' },
      data: { status: 'Removed' },
    });

    const document = await tx.document.findFirst({ where: { id: documentId, organizationId } });
    if (!document) {
      // No document with this id exists for this organizationId — either a
      // bad id, or (defense-in-depth) a documentId belonging to a
      // different organization. Never throws: matches
      // DocumentRepository.updateById's existing "not found under this
      // tenant scope" convention.
      return null;
    }

    if (updated.count === 0) {
      // Already Removed, or the WHERE clause otherwise matched nothing new
      // to transition — no release, nothing to report as "just happened."
      return { document, released: false };
    }

    await releaseDocumentSlot(organizationId, tx);
    return { document, released: true };
  });
}
