import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createTenantContext, type MicrosoftTenant, type SharePointSite } from '@sph/database';
import { DiscoveryProducerService } from '../discovery/discovery-producer.service';

/**
 * ADR-0014 (amended 2026-07-20): approval decisions are made here, but
 * discovery *execution* is not — it moved to apps/worker's
 * SiteDiscoveryProcessor, reached only by enqueueing through
 * DiscoveryProducerService (the single sanctioned producer, also used by
 * the consent-callback bootstrap). This service never calls
 * @sph/graph-client directly for discovery anymore.
 */
@Injectable()
export class SharePointSitesService {
  constructor(private readonly discoveryProducer: DiscoveryProducerService) {}

  async enqueueDiscovery(organizationId: string, microsoftTenantId: string): Promise<MicrosoftTenant> {
    return this.discoveryProducer.enqueueDiscovery(organizationId, microsoftTenantId);
  }

  /**
   * Phase 9.5: convenience entry point for the dashboard's Sites page —
   * mirrors ScansService.triggerScanForOrganization's exact auto-resolve
   * shape (the common case is one connected Microsoft tenant per
   * organization, ADR-0012's self-service onboarding flow) so the web UI
   * never needs to know a microsoftTenantId just to trigger discovery.
   * Delegates entirely to enqueueDiscovery once the tenant is resolved — no
   * new discovery logic here.
   */
  async enqueueDiscoveryForOrganization(organizationId: string): Promise<MicrosoftTenant> {
    const context = createTenantContext(organizationId);
    const consentedTenants = await context.microsoftTenants.findMany({ where: { status: 'Consented' } });

    if (consentedTenants.length === 0) {
      throw new NotFoundException('No connected Microsoft tenant for this organization');
    }
    if (consentedTenants.length > 1) {
      throw new ConflictException(
        'Organization has more than one connected Microsoft tenant; specify microsoftTenantId',
      );
    }

    const [onlyTenant] = consentedTenants;
    if (!onlyTenant) {
      throw new NotFoundException('No connected Microsoft tenant for this organization');
    }
    return this.enqueueDiscovery(organizationId, onlyTenant.id);
  }

  // Deterministic order (2026-07-25 fix): findMany() with no orderBy makes
  // no ordering guarantee, and an UPDATE (approveSite/revokeSite) can
  // change a row's returned position on the next query under Postgres's
  // MVCC — observed live as an approved site visibly relocating in the web
  // UI's list. Ordering by displayName means a site's position no longer
  // depends on its status at all, so approving/revoking it never
  // repositions it within the full (unfiltered) list.
  async listSites(organizationId: string): Promise<SharePointSite[]> {
    const context = createTenantContext(organizationId);
    return context.sharePointSites.findMany({ orderBy: { displayName: 'asc' } });
  }

  async approveSite(organizationId: string, siteId: string, approvedByUserId: string): Promise<SharePointSite> {
    const context = createTenantContext(organizationId);
    const updated = await context.sharePointSites.updateById(siteId, {
      status: 'Approved',
      approvedAt: new Date(),
      approvedByUserId,
    });
    if (!updated) throw new NotFoundException('SharePoint site not found');
    return updated;
  }

  async revokeSite(organizationId: string, siteId: string): Promise<SharePointSite> {
    const context = createTenantContext(organizationId);
    const updated = await context.sharePointSites.updateById(siteId, { status: 'Removed' });
    if (!updated) throw new NotFoundException('SharePoint site not found');
    return updated;
  }
}
