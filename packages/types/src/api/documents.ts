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
