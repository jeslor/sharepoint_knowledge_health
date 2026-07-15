// See documents.ts header — same rationale (ADR-0009 shared API DTOs).
// Mirrors the wire shape SharePointSitesController actually serializes
// (apps/api returns the Prisma entity directly for this resource, same as
// ScansController does for ScanResponse) — dates arrive as ISO strings,
// never as Date objects or @prisma/client types.

export type SharePointSiteStatusValue = 'Discovered' | 'Approved' | 'Removed';

export interface SharePointSiteResponse {
  id: string;
  organizationId: string;
  microsoftTenantId: string;
  graphSiteId: string;
  siteUrl: string;
  displayName: string;
  status: SharePointSiteStatusValue;
  approvedAt: string | null;
  approvedByUserId: string | null;
  lastScannedAt: string | null;
  createdAt: string;
}
