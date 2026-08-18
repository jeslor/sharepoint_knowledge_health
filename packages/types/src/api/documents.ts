// API request/response DTOs (ADR-0009 §"Repository shape" — shared between
// apps/api, the source of truth for these shapes, and apps/web, the
// consumer, so the two never drift). Deliberately plain data, not Prisma
// types — apps/web must never depend on @prisma/client even transitively.

export interface DocumentResponse {
  id: string;
  siteId: string;
  graphItemId: string;
  name: string;
  path: string;
  fileType: string;
  sizeBytes: string;
  sourceCreatedAt: string;
  sourceModifiedAt: string;
  status: string;
  currentHealthScoreId: string | null;
  ingestedAt: string;
}

export interface DocumentHealthIssueResponse {
  type: string;
  severity: string;
  message: string;
}

export interface DocumentHealthResponse {
  documentId: string;
  documentName: string;
  siteId: string;
  siteName: string;
  owner: string | null;
  status: string;
  lastModifiedAt: string;
  score: number;
  band: string;
  issueCount: number;
  calculatedAt: string;
  issues: DocumentHealthIssueResponse[];
}

export interface DocumentDetailResponse {
  documentId: string;
  documentName: string;
  siteId: string;
  siteName: string;
  path: string;
  fileType: string;
  sizeBytes: string;
  owner: string | null;
  ownerEmail: string | null;
  status: string;
  sourceCreatedAt: string;
  sourceModifiedAt: string;
  score: number | null;
  band: string | null;
  calculatedAt: string | null;
  issues: DocumentHealthIssueResponse[];
  nextReviewDueAt: string | null;
  reviewDateSource: string | null;
  // Phase 2: the confirmed SharePoint column's display name, when
  // reviewDateSource is GraphMetadata and one can be resolved — null for
  // a Manual date, or when no mapping can be resolved for this document's
  // library. Lets the UI show "Source: SharePoint · Review Date" instead
  // of just "SharePoint".
  reviewDateColumnDisplayName: string | null;
  // Phase 3A-1: whether this document's LIBRARY currently has an Active
  // SharePointReviewDateMapping — independent of reviewDateSource, which
  // only reflects this document's own last-synced value. A document that
  // has never been scanned since its library's mapping was confirmed
  // still needs sharePointManaged: true, so the UI can correctly disable
  // manual editing before the first sync ever runs. When true, the manual
  // review-date editor must not be shown; setReviewDate also rejects a
  // conflicting write (409) for the same reason.
  sharePointManaged: boolean;
  // The mapped column's display name whenever sharePointManaged is true —
  // separate from reviewDateColumnDisplayName (which stays gated on
  // reviewDateSource, unchanged) so this field is reliably populated even
  // pre-first-sync.
  sharePointManagedColumnDisplayName: string | null;
  webUrl: string | null;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

export type DocumentHealthSortBy = 'score' | 'name' | 'lastModified';
export type SortDirection = 'asc' | 'desc';
// Matches packages/scoring's IssueSeverity — redeclared here rather than
// imported, since packages/types must stay independent of packages/scoring.
export type IssueSeverityFilter = 'NeedsAttention' | 'RequiresReview';

export interface DocumentHealthQuery {
  page?: number;
  pageSize?: number;
  sortBy?: DocumentHealthSortBy;
  sortDir?: SortDirection;
  severity?: IssueSeverityFilter;
  siteId?: string;
  minScore?: number;
  maxScore?: number;
}

// Phase 8B / ADR-0016 §4.2: source distinguishes worker-owned (GraphMetadata)
// from governance-API-owned (ManualAssignment) rows — apps/web only ever
// mutates ManualAssignment rows through the ownership endpoints.
export interface DocumentOwnerResponse {
  id: string;
  ownerType: string;
  displayName: string | null;
  email: string | null;
  source: string;
  assignedByUserId: string | null;
  assignedAt: string | null;
}

export interface AssignDocumentOwnerRequest {
  displayName?: string | null;
  email?: string | null;
}

// ADR-0002 amendment / ADR-0016 §4.3, §7: the only write path for
// Document.nextReviewDueAt, the real signal apps/worker's scoring pass
// reads for the ReviewStatus criterion. null clears a previously-set date.
export interface SetDocumentReviewDateRequest {
  nextReviewDueAt: string | null;
}

export interface DocumentReviewResponse {
  documentId: string;
  nextReviewDueAt: string | null;
  reviewDateSource: string;
}
