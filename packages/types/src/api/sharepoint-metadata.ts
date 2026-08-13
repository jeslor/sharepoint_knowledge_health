// SharePoint metadata integration, Phase 1b: the minimal confirm action
// for a single structurally unambiguous review-date column candidate.
// Deliberately no "list candidates" endpoint here — Phase 1 has no
// browsing UI; a caller confirms a specific (site, list), and the service
// itself determines live whether that library currently has exactly one
// dateTime candidate.

// Phase 2: columnDefinitionId is required only when the caller already
// knows the library has multiple eligible candidates (from a prior
// eligibility check) and is explicitly selecting one — never a guess, the
// server re-validates the selection against the *current* live candidate
// set at confirm time, not whatever the client happened to remember.
// Omitted (or ignored, if the library resolves to exactly one candidate)
// for the single-candidate case.
export interface ConfirmReviewDateMappingRequest {
  graphListId: string;
  columnDefinitionId?: string;
}

export interface ReviewDateMappingResponse {
  id: string;
  siteId: string;
  graphListId: string;
  columnDefinitionId: string;
  columnDisplayName: string;
  status: string;
  confirmedByUserId: string;
  // Phase 2: resolved at read time (never persisted) so the UI can show
  // "Confirmed by {name}" without a separate users lookup. Null when the
  // confirming user's row no longer resolves (e.g. deactivated/deleted).
  confirmedByDisplayName: string | null;
  confirmedAt: string;
}

// Phase 2: enumerates a site's document libraries so the UI has something
// to list — eligibility/confirm both require a graphListId as input and
// have no way to discover one themselves. mapping is null when no
// SharePointReviewDateMapping row exists yet for that library (the
// "not checked" / "checked, nothing confirmed" states are both null here;
// the UI distinguishes them via its own local/session state of whether an
// eligibility check has been run, not via any server-persisted flag).
export interface ReviewDateLibraryResponse {
  graphListId: string;
  driveId: string;
  name: string;
  mapping: ReviewDateMappingResponse | null;
}

// Phase 1.1: read-only discovery, separate from the mutating confirm
// action above — lets a caller inspect a library's eligibility state
// without attempting (and risking side effects from) a confirm call.
// confidence is display-only metadata for a future admin selection UI; it
// never changes which of these three states applies.
export type ReviewDateCandidateConfidence = 'high' | 'medium' | 'low';

export interface ReviewDateEligibilityColumn {
  id: string;
  name: string;
  displayName: string;
  confidence: ReviewDateCandidateConfidence;
}

export type ReviewDateEligibilityResponse =
  | { status: 'NoEligibleColumn' }
  | { status: 'SingleEligibleColumn'; column: ReviewDateEligibilityColumn }
  | { status: 'MultipleEligibleColumns'; columns: ReviewDateEligibilityColumn[] };
