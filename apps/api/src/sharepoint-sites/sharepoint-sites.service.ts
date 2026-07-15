import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createTenantContext, type SharePointSite } from '@sph/database';
import { listSites } from '@sph/graph-client';
import { randomUUID } from 'node:crypto';

/**
 * ADR-0014: this is the one place site discovery/approval decisions are
 * made. Discovery never touches status/approval on an already-known site
 * (re-running discovery must not reset an Approved site back to
 * Discovered), and a newly discovered site always starts Discovered —
 * never auto-approved, under any circumstance.
 */
@Injectable()
export class SharePointSitesService {
  async discoverSites(organizationId: string, microsoftTenantId: string): Promise<SharePointSite[]> {
    const context = createTenantContext(organizationId);
    const correlationId = randomUUID();

    const microsoftTenant = await context.microsoftTenants.findFirstById(microsoftTenantId);
    if (!microsoftTenant) {
      throw new NotFoundException('Microsoft tenant not found');
    }

    const existingSites = await context.sharePointSites.findMany({ where: { microsoftTenantId } });
    const existingByGraphSiteId = new Map(existingSites.map((site) => [site.graphSiteId, site]));

    const results: SharePointSite[] = [];
    for await (const graphSite of listSites(microsoftTenant.entraTenantId, { correlationId })) {
      const existing = existingByGraphSiteId.get(graphSite.id);
      if (existing) {
        results.push(existing);
        continue;
      }

      const created = await context.sharePointSites.create({
        microsoftTenantId,
        graphSiteId: graphSite.id,
        siteUrl: graphSite.webUrl,
        displayName: graphSite.displayName,
      });
      results.push(created);
    }

    return results;
  }

  /**
   * Phase 9.5: convenience entry point for the dashboard's Sites page —
   * mirrors ScansService.triggerScanForOrganization's exact auto-resolve
   * shape (the common case is one connected Microsoft tenant per
   * organization, ADR-0012's self-service onboarding flow) so the web UI
   * never needs to know a microsoftTenantId just to discover sites.
   * Delegates entirely to discoverSites once the tenant is resolved — no
   * new discovery logic here.
   */
  async discoverSitesForOrganization(organizationId: string): Promise<SharePointSite[]> {
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
    return this.discoverSites(organizationId, onlyTenant.id);
  }

  async listSites(organizationId: string): Promise<SharePointSite[]> {
    const context = createTenantContext(organizationId);
    return context.sharePointSites.findMany();
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
