import { Injectable, NotFoundException } from '@nestjs/common';
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
