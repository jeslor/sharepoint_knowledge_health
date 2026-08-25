import type { Document, TenantContext } from '@sph/database';
import { calculateScore, type ScoreResult, type SiblingDocumentInput } from '@sph/scoring';
import { buildScoringInput } from './build-scoring-input';

/**
 * ADR-0022 §3.4/§13.2, Phase 5: the "rescore one document" primitive
 * neither this codebase nor ADR-0022 previously had. Reuses
 * `calculateScore` (unchanged) and `buildScoringInput` (shared with the
 * full-scan path, document-collector.processor.ts) — the only new code
 * here is the query strategy: narrowly scoped to the one document being
 * verified, rather than document-collector.processor.ts's tenant-wide
 * batch sweep.
 *
 * Produces the *same* ScoreResult a normal scan would compute for this
 * document at this moment — the sibling-document query below returns the
 * identical set the batch path's in-memory `siblingsByKey` grouping would
 * produce for this one document (same filter: Active, same tenant, exact
 * name+sizeBytes match), just fetched directly instead of pre-computed
 * for an entire tenant sweep.
 *
 * Deliberately compute-only: no HealthScore/HealthIssue row is persisted,
 * and Document.currentHealthScoreId is never touched. HealthScore.scanJobId
 * is a required (non-nullable) foreign key — there is no ScanJob behind a
 * remediation-triggered rescore, and fabricating one would be a dishonest
 * audit trail. This was a real, confirmed schema conflict — resolved by
 * scoping this function to exactly what ADR-0022 §13.2 actually needs (a
 * determination of whether one criterion's issue is still present), not
 * persisted scoring history. Consequence, accepted explicitly: the
 * document's displayed health score/history will not reflect this
 * recalculation until the next real scan runs — governance resolution
 * (governance-resolution.ts) still happens correctly and immediately,
 * based on this fresh computation.
 */
export async function rescoreDocument(context: TenantContext, document: Document, now: Date = new Date()): Promise<ScoreResult> {
  const site = await context.sharePointSites.findFirstById(document.siteId);
  if (!site) {
    throw new Error(`SharePointSite ${document.siteId} not found for document ${document.id}`);
  }

  const owners = await context.documentOwners.findMany({ where: { documentId: document.id } });
  const ownerEmails = owners.map((owner) => owner.email).filter((email): email is string => email !== null);
  const registeredUsers = ownerEmails.length > 0 ? await context.users.findMany({ where: { email: { in: ownerEmails } } }) : [];
  const activeByEmail = new Map(registeredUsers.map((user) => [user.email, user.status === 'Active']));

  const siblingRows = await context.documents.findMany({
    where: {
      status: 'Active',
      site: { microsoftTenantId: site.microsoftTenantId },
      name: document.name,
      sizeBytes: document.sizeBytes,
    },
  });
  const siblingDocuments: SiblingDocumentInput[] = siblingRows.map((row) => ({
    id: row.id,
    name: row.name,
    sizeBytes: Number(row.sizeBytes),
  }));

  return calculateScore(buildScoringInput(document, owners, activeByEmail, siblingDocuments, now));
}
