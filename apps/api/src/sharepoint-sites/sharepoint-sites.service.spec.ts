import { ConflictException, NotFoundException } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import { SharePointSitesService } from './sharepoint-sites.service';
import type { DiscoveryProducerService } from '../discovery/discovery-producer.service';
import { AuditLogService } from '../audit-log/audit-log.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('SharePointSitesService', () => {
  const discoveryProducer = { enqueueDiscovery: jest.fn() };
  const auditLog = { record: jest.fn() } as unknown as jest.Mocked<AuditLogService>;
  const service = new SharePointSitesService(discoveryProducer as unknown as DiscoveryProducerService, auditLog);

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

  // Root cause regression test (2026-07-25): findMany() with no orderBy
  // makes no ordering guarantee — an approve/revoke UPDATE could change a
  // row's returned position on the next query, observed live as a site
  // visibly relocating in the web UI. A stable orderBy fixes this.
  describe('listSites', () => {
    it('requests a deterministic order (by displayName)', async () => {
      sharePointSites.findMany.mockResolvedValue([]);

      await service.listSites('org-1');

      expect(sharePointSites.findMany).toHaveBeenCalledWith({ orderBy: { displayName: 'asc' } });
    });

    it('returns whatever the repository resolves, unchanged', async () => {
      const sites = [{ id: 'site-1' }, { id: 'site-2' }];
      sharePointSites.findMany.mockResolvedValue(sites);

      const result = await service.listSites('org-1');

      expect(result).toBe(sites);
    });
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

    it('records an audit log entry with the approving user as actor', async () => {
      sharePointSites.updateById.mockResolvedValue({ id: 'site-1', status: 'Approved' });

      await service.approveSite('org-1', 'site-1', 'user-1');

      expect(auditLog.record).toHaveBeenCalledWith('org-1', {
        actorUserId: 'user-1',
        action: 'sharepoint_site.approved',
        targetType: 'SharePointSite',
        targetId: 'site-1',
      });
    });

    it('throws NotFoundException when the site does not exist for this organization, and never records an audit entry', async () => {
      sharePointSites.updateById.mockResolvedValue(null);

      await expect(service.approveSite('org-1', 'site-missing', 'user-1')).rejects.toThrow(NotFoundException);
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });

  describe('revokeSite', () => {
    it('sets status Removed', async () => {
      const updated = { id: 'site-1', status: 'Removed' };
      sharePointSites.updateById.mockResolvedValue(updated);

      const result = await service.revokeSite('org-1', 'site-1', 'user-1');

      expect(sharePointSites.updateById).toHaveBeenCalledWith('site-1', { status: 'Removed' });
      expect(result).toBe(updated);
    });

    it('records an audit log entry with the revoking user as actor', async () => {
      sharePointSites.updateById.mockResolvedValue({ id: 'site-1', status: 'Removed' });

      await service.revokeSite('org-1', 'site-1', 'user-1');

      expect(auditLog.record).toHaveBeenCalledWith('org-1', {
        actorUserId: 'user-1',
        action: 'sharepoint_site.revoked',
        targetType: 'SharePointSite',
        targetId: 'site-1',
      });
    });

    it('throws NotFoundException when the site does not exist for this organization, and never records an audit entry', async () => {
      sharePointSites.updateById.mockResolvedValue(null);

      await expect(service.revokeSite('org-1', 'site-missing', 'user-1')).rejects.toThrow(NotFoundException);
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });
});
