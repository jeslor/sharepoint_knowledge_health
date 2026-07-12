import type { CriterionResult, ScoringInput } from '../types';
import { severityForScore } from './shared';

const INACTIVE_OWNER_SCORE = 40;

/**
 * "Missing owner -> reduce score" and "Inactive owner -> reduce score",
 * folded into one criterion rather than a 7th enum value (Phase 5 scope
 * decision) — both are facets of the same underlying question: is there a
 * reliable, currently-valid owner for this document?
 */
export function scoreOwnership(input: ScoringInput): CriterionResult {
  const identifiableOwners = input.owners.filter((owner) => owner.email !== null);

  if (identifiableOwners.length === 0) {
    return {
      score: 0,
      issue: {
        type: 'Ownership',
        severity: 'RequiresReview',
        message: 'Document has no identifiable owner.',
      },
    };
  }

  // Best-effort only: can only judge "active" for owners whose email
  // resolves to a registered User (isActiveUser !== null) — see ScoringInput.
  const resolvedOwners = identifiableOwners.filter((owner) => owner.isActiveUser !== null);
  const allResolvedOwnersInactive = resolvedOwners.length > 0 && resolvedOwners.every((owner) => owner.isActiveUser === false);

  if (allResolvedOwnersInactive) {
    return {
      score: INACTIVE_OWNER_SCORE,
      issue: {
        type: 'Ownership',
        severity: severityForScore(INACTIVE_OWNER_SCORE),
        message: 'Document owner is no longer an active user.',
      },
    };
  }

  return { score: 100 };
}
