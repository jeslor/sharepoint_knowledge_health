import { ConflictException, NotFoundException } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import { listSites } from '@sph/graph-client';
import { SharePointSitesService } from './sharepoint-sites.service';

jest.mock('@sph/database');
jest.mock('@sph/graph-client');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;
const mockedListSites = listSites as jest.MockedFunction<typeof listSites>;

async function* graphSites(sites: Array<{ id: string; webUrl: string; displayName: string }>) {
  for (const site of sites) yield site;
}

describe('SharePointSitesService', () => {
  const service = new SharePointSitesService();

  const microsoftTenants = { findFirstById: jest.fn(), findMany: jest.fn() };
  const sharePointSites = {
    findMany: jest.fn(),
    create: jest.fn(),
    updateById: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ microsoftTenants, sharePointSites } as never);
  });

  describe('discoverSites', () => {
    it('throws NotFoundException when the microsoft tenant does not exist', async () => {
      microsoftTenants.findFirstById.mockResolvedValue(null);

      await expect(service.discoverSites('org-1', 'tenant-missing')).rejects.toThrow(NotFoundException);
    });

    it('creates a new Discovered site for a graph site never seen before', async () => {
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', entraTenantId: 'entra-1' });
      sharePointSites.findMany.mockResolvedValue([]);
      mockedListSites.mockReturnValue(graphSites([{ id: 'graph-site-1', webUrl: 'https://x', displayName: 'Site 1' }]));
      const created = { id: 'site-1', graphSiteId: 'graph-site-1', status: 'Discovered' };
      sharePointSites.create.mockResolvedValue(created);

      const result = await service.discoverSites('org-1', 'tenant-1');

      expect(sharePointSites.create).toHaveBeenCalledWith({
        microsoftTenantId: 'tenant-1',
        graphSiteId: 'graph-site-1',
        siteUrl: 'https://x',
        displayName: 'Site 1',
      });
      expect(result).toEqual([created]);
    });

    it('never resets status/approval on rediscovery of an already-known site (ADR-0014)', async () => {
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', entraTenantId: 'entra-1' });
      const existingApproved = { id: 'site-1', graphSiteId: 'graph-site-1', status: 'Approved' };
      sharePointSites.findMany.mockResolvedValue([existingApproved]);
      mockedListSites.mockReturnValue(graphSites([{ id: 'graph-site-1', webUrl: 'https://x', displayName: 'Site 1' }]));

      const result = await service.discoverSites('org-1', 'tenant-1');

      expect(sharePointSites.create).not.toHaveBeenCalled();
      expect(sharePointSites.updateById).not.toHaveBeenCalled();
      expect(result).toEqual([existingApproved]);
    });
  });

  describe('discoverSitesForOrganization', () => {
    it('resolves the org\'s single Consented tenant and delegates to discoverSites', async () => {
      microsoftTenants.findMany.mockResolvedValue([{ id: 'tenant-1', status: 'Consented' }]);
      const discoverSitesSpy = jest.spyOn(service, 'discoverSites').mockResolvedValue([{ id: 'site-1' } as never]);

      const result = await service.discoverSitesForOrganization('org-1');

      expect(discoverSitesSpy).toHaveBeenCalledWith('org-1', 'tenant-1');
      expect(result).toEqual([{ id: 'site-1' }]);
    });

    it('throws NotFoundException when no Microsoft tenant is connected', async () => {
      microsoftTenants.findMany.mockResolvedValue([]);

      await expect(service.discoverSitesForOrganization('org-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when more than one Microsoft tenant is connected', async () => {
      microsoftTenants.findMany.mockResolvedValue([{ id: 'tenant-1' }, { id: 'tenant-2' }]);

      await expect(service.discoverSitesForOrganization('org-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('approveSite', () => {
    it('sets status Approved with the approving user and timestamp', async () => {
      const updated = { id: 'site-1', status: 'Approved' };
      sharePointSites.updateById.mockResolvedValue(updated);

      const result = await service.approveSite('org-1', 'site-1', 'user-1');

      expect(sharePointSites.updateById).toHaveBeenCalledWith(
        'site-1',
        expect.objectContaining({ status: 'Approved', approvedByUserId: 'user-1' }),
      );
      expect(result).toBe(updated);
    });

    it('throws NotFoundException when the site does not exist for this organization', async () => {
      sharePointSites.updateById.mockResolvedValue(null);

      await expect(service.approveSite('org-1', 'site-missing', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('revokeSite', () => {
    it('sets status Removed', async () => {
      const updated = { id: 'site-1', status: 'Removed' };
      sharePointSites.updateById.mockResolvedValue(updated);

      const result = await service.revokeSite('org-1', 'site-1');

      expect(sharePointSites.updateById).toHaveBeenCalledWith('site-1', { status: 'Removed' });
      expect(result).toBe(updated);
    });

    it('throws NotFoundException when the site does not exist for this organization', async () => {
      sharePointSites.updateById.mockResolvedValue(null);

      await expect(service.revokeSite('org-1', 'site-missing')).rejects.toThrow(NotFoundException);
    });
  });
});
