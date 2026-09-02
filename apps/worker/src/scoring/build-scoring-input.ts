import type { Document, DocumentOwner } from '@sph/database';
import type { ClassificationFieldInput, DocumentOwnerInput, ScoringInput, SiblingDocumentInput } from '@sph/scoring';

/**
 * ADR-0022 Phase 5: extracted, unchanged, from document-collector.processor.ts's
 * scoreTenantDocuments loop — the exact mapping from persisted
 * rows (Document/DocumentOwner + the active-user lookup + the sibling set)
 * to calculateScore's ScoringInput shape, byte-for-byte identical to what
 * that loop already builds inline. This is the one shared piece both the
 * full-scan batch path and Phase 5's single-document rescore path call, so
 * neither duplicates the mapping logic — calculateScore itself (@sph/scoring)
 * is untouched either way.
 *
 * Deliberately still takes owners/activeByEmail/siblingDocuments as
 * pre-resolved inputs rather than querying anything itself — the batch
 * path already has these computed once per scan (Map lookups, no per-
 * document query); the single-document path (rescore-document.ts) does
 * its own narrowly-scoped queries and passes the results in exactly the
 * same shape. Neither caller's query strategy is this function's concern.
 */
export function buildScoringInput(
  document: Pick<Document, 'id' | 'name' | 'sourceCreatedAt' | 'sourceModifiedAt' | 'sizeBytes' | 'nextReviewDueAt'>,
  owners: Pick<DocumentOwner, 'email'>[],
  activeByEmail: ReadonlyMap<string, boolean>,
  siblingDocuments: SiblingDocumentInput[],
  now: Date,
  // ADR-0025: pre-resolved active classification fields for this document's
  // library, each already flagged populated/not — same "caller pre-resolves,
  // this function only maps" contract as owners/siblingDocuments. An empty
  // array means the library has no classification policy (D=0 -> neutral).
  classificationFields: ClassificationFieldInput[] = [],
): ScoringInput {
  const ownerInputs: DocumentOwnerInput[] = owners.map((owner) => ({
    email: owner.email,
    isActiveUser: owner.email !== null ? (activeByEmail.get(owner.email) ?? null) : null,
  }));

  return {
    documentId: document.id,
    documentName: document.name,
    sourceCreatedAt: document.sourceCreatedAt,
    sourceModifiedAt: document.sourceModifiedAt,
    sizeBytes: Number(document.sizeBytes),
    nextReviewDueAt: document.nextReviewDueAt,
    owners: ownerInputs,
    siblingDocuments,
    classificationFields,
    now,
  };
}
