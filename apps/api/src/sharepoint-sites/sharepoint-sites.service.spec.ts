import { ConflictException, NotFoundException } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import { SharePointSitesService } from './sharepoint-sites.service';
import type { DiscoveryProducerService } from '../discovery/discovery-producer.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('SharePointSitesService', () => {
  const discoveryProducer = { enqueueDiscovery: jest.fn() };
  const service = new SharePointSitesService(discoveryProducer as unknown as DiscoveryProducerService);

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

  describe('enqueueDiscovery', () => {
    it('delegates to DiscoveryProducerService, unchanged', async () => {
      const queued = { id: 'tenant-1', discoveryStatus: 'Queued' };
      discoveryProducer.enqueueDiscovery.mockResolvedValue(queued);

      const result = await service.enqueueDiscovery('org-1', 'tenant-1');

      expect(discoveryProducer.enqueueDiscovery).toHaveBeenCalledWith('org-1', 'tenant-1');
      expect(result).toBe(queued);
    });
  });

  describe('enqueueDiscoveryForOrganization', () => {
    it("resolves the org's single Consented tenant and delegates to enqueueDiscovery", async () => {
      microsoftTenants.findMany.mockResolvedValue([{ id: 'tenant-1', status: 'Consented' }]);
      const queued = { id: 'tenant-1', discoveryStatus: 'Queued' };
      discoveryProducer.enqueueDiscovery.mockResolvedValue(queued);

      const result = await service.enqueueDiscoveryForOrganization('org-1');

      expect(discoveryProducer.enqueueDiscovery).toHaveBeenCalledWith('org-1', 'tenant-1');
      expect(result).toBe(queued);
    });

    it('throws NotFoundException when no Microsoft tenant is connected', async () => {
      microsoftTenants.findMany.mockResolvedValue([]);

      await expect(service.enqueueDiscoveryForOrganization('org-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when more than one Microsoft tenant is connected', async () => {
      microsoftTenants.findMany.mockResolvedValue([{ id: 'tenant-1' }, { id: 'tenant-2' }]);

      await expect(service.enqueueDiscoveryForOrganization('org-1')).rejects.toThrow(ConflictException);
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
