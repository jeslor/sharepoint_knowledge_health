import { SharePointSitesController } from './sharepoint-sites.controller';
import type { SharePointSitesService } from './sharepoint-sites.service';

describe('SharePointSitesController', () => {
  const service = {
    discoverSites: jest.fn(),
    discoverSitesForOrganization: jest.fn(),
    listSites: jest.fn(),
    approveSite: jest.fn(),
    revokeSite: jest.fn(),
  };
  const controller = new SharePointSitesController(service as unknown as SharePointSitesService);

  beforeEach(() => jest.clearAllMocks());

  it('discoverSites delegates organizationId and tenantId from the route', async () => {
    service.discoverSites.mockResolvedValue([{ id: 'site-1' }]);

    const result = await controller.discoverSites('org-1', 'tenant-1');

    expect(service.discoverSites).toHaveBeenCalledWith('org-1', 'tenant-1');
    expect(result).toEqual([{ id: 'site-1' }]);
  });

  it('discoverSitesForOrganization delegates organizationId only, never a client-supplied tenantId', async () => {
    service.discoverSitesForOrganization.mockResolvedValue([{ id: 'site-1' }]);

    const result = await controller.discoverSitesForOrganization('org-1');

    expect(service.discoverSitesForOrganization).toHaveBeenCalledWith('org-1');
    expect(result).toEqual([{ id: 'site-1' }]);
  });

  it('listSites delegates organizationId from the route', async () => {
    service.listSites.mockResolvedValue([]);

    await controller.listSites('org-1');

    expect(service.listSites).toHaveBeenCalledWith('org-1');
  });

  it('approveSite delegates organizationId, siteId, and the current user id — never trusts a client-supplied approver', async () => {
    service.approveSite.mockResolvedValue({ id: 'site-1', status: 'Approved' });

    await controller.approveSite('org-1', 'site-1', { id: 'user-1' } as never);

    expect(service.approveSite).toHaveBeenCalledWith('org-1', 'site-1', 'user-1');
  });

  it('revokeSite delegates organizationId and siteId', async () => {
    service.revokeSite.mockResolvedValue({ id: 'site-1', status: 'Removed' });

    await controller.revokeSite('org-1', 'site-1');

    expect(service.revokeSite).toHaveBeenCalledWith('org-1', 'site-1');
  });
});
