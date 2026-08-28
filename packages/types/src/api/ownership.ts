// ADR-0024 Phase A: read-only ownership coverage reporting. See that ADR
// for the exact metric definitions and the five invariants these types are
// built to make impossible to violate silently.

export interface OwnershipCoverageBucket {
  covered: number;
  noIdentifiableOwner: number;
  allOwnersInactive: number;
  notYetScored: number;
  // Invariant 1: covered + noIdentifiableOwner + allOwnersInactive + notYetScored === totalDocuments
  totalDocuments: number;
  // Invariant 2: scoredDocuments === covered + noIdentifiableOwner + allOwnersInactive
  // (=== totalDocuments - notYetScored). Provided explicitly so a consumer
  // never has to re-derive it, and never mistakenly uses totalDocuments as
  // the coverage-percentage denominator instead.
  scoredDocuments: number;
  // Invariant 3: round(covered / scoredDocuments * 100) when scoredDocuments > 0,
  // otherwise null. NEVER 0 when scoredDocuments is 0 — null unambiguously
  // means "nothing scored yet," 0 unambiguously means "scored, and none of
  // it covered."
  coveragePercentage: number | null;
}

export interface OwnershipCoverageBySite extends OwnershipCoverageBucket {
  siteId: string;
  siteName: string;
}

// Invariant 5: row-level counts, independent of the document-level coverage
// buckets above — never usable as, or comparable to, the coverage
// percentage's denominator.
export interface OwnershipSourceBreakdown {
  graphMetadataCount: number;
  manualAssignmentCount: number;
}

// Secondary/descriptive only (ADR-0024 §3.2) — external/unregistered is not
// a failure state on its own; this never feeds into coveragePercentage.
export interface OwnershipIdentityBreakdown {
  activeRegisteredCount: number;
  deactivatedRegisteredCount: number;
  externalOrUnregisteredCount: number;
}

export interface OwnershipCoverageResponse {
  organizationWide: OwnershipCoverageBucket;
  // Invariant 4: sum(bySite[].totalDocuments) === organizationWide.totalDocuments.
  // Includes every site with at least one Active document, regardless of
  // that site's current SharePointSiteStatus (ADR-0024 §3.2).
  bySite: OwnershipCoverageBySite[];
  ownerSourceBreakdown: OwnershipSourceBreakdown;
  identityBreakdown: OwnershipIdentityBreakdown;
  calculatedAt: string;
}
