// See sharepoint-sites.ts header — same convention: SharePointSitesController
// returns the MicrosoftTenant Prisma entity directly for the discover-sites
// routes (ADR-0014 amendment) — dates arrive as ISO strings, never Date
// objects or @prisma/client types.

import type { DiscoveryStatusValue, MicrosoftTenantStatusValue } from './onboarding-status';

export interface MicrosoftTenantResponse {
  id: string;
  organizationId: string;
  entraTenantId: string;
  tenantName: string;
  status: MicrosoftTenantStatusValue;
  consentGrantedAt: string | null;
  consentGrantedByUserId: string | null;
  discoveryStatus: DiscoveryStatusValue;
  discoveryStartedAt: string | null;
  discoveryCompletedAt: string | null;
  discoveryError: string | null;
  createdAt: string;
}
