import { Injectable, NotFoundException } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import type { OnboardingStatusResponse } from '@sph/types';

/**
 * ADR-0017 (partial implementation — Phase 1b only): purely a derived read
 * over existing tables, never a stored progress flag. This phase covers
 * only the discovery slice of the eventual full onboarding-status shape
 * (sitesApproved/scheduleConfigured/firstScanCompleted are later phases'
 * fields, added to this same response/endpoint as they're built — never a
 * competing implementation).
 */
@Injectable()
export class OnboardingStatusService {
  async getStatus(organizationId: string): Promise<OnboardingStatusResponse> {
    const context = createTenantContext(organizationId);

    // ADR-0012 bootstraps exactly one MicrosoftTenant together with the
    // Organization; ADR-0007 allows more than one over time (e.g. a
    // subsidiary's separate Azure AD tenant). This phase reports on the
    // first-connected one — the same simplification already accepted
    // elsewhere for "the common case is one connected tenant per org"
    // (ScansService.triggerScanForOrganization, SharePointSitesService).
    const [tenant] = await context.microsoftTenants.findMany({ orderBy: { createdAt: 'asc' }, take: 1 });
    if (!tenant) {
      throw new NotFoundException('No Microsoft tenant found for this organization');
    }

    return {
      microsoftTenantStatus: tenant.status,
      discoveryStatus: tenant.discoveryStatus,
      discoveryStartedAt: tenant.discoveryStartedAt?.toISOString() ?? null,
      discoveryCompletedAt: tenant.discoveryCompletedAt?.toISOString() ?? null,
      discoveryError: tenant.discoveryError,
    };
  }
}
