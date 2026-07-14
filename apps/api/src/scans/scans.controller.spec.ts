import { ScansController } from './scans.controller';
import type { ScansService } from './scans.service';

describe('ScansController', () => {
  const service = {
    triggerScan: jest.fn(),
    triggerScanForOrganization: jest.fn(),
    getScan: jest.fn(),
    listScans: jest.fn(),
    getScanComparison: jest.fn(),
  };
  const controller = new ScansController(service as unknown as ScansService);

  beforeEach(() => jest.clearAllMocks());

  it('triggerScan delegates organizationId, tenantId, and the current user id', async () => {
    service.triggerScan.mockResolvedValue({ id: 'scan-1', status: 'Queued' });

    await controller.triggerScan('org-1', 'tenant-1', { id: 'user-1' } as never);

    expect(service.triggerScan).toHaveBeenCalledWith('org-1', 'tenant-1', 'user-1');
  });

  it('getScan delegates organizationId and scanId', async () => {
    service.getScan.mockResolvedValue({ id: 'scan-1', status: 'Completed' });

    await controller.getScan('org-1', 'scan-1');

    expect(service.getScan).toHaveBeenCalledWith('org-1', 'scan-1');
  });

  it('getScanComparison delegates organizationId and scanId', async () => {
    service.getScanComparison.mockResolvedValue({ scanId: 'scan-1', previousScanId: null });

    await controller.getScanComparison('org-1', 'scan-1');

    expect(service.getScanComparison).toHaveBeenCalledWith('org-1', 'scan-1');
  });

  it('listScans delegates organizationId from the route', async () => {
    service.listScans.mockResolvedValue([]);

    await controller.listScans('org-1');

    expect(service.listScans).toHaveBeenCalledWith('org-1');
  });

  describe('triggerScanForOrganization', () => {
    it('delegates organizationId, the current user id, and an omitted microsoftTenantId when no body is sent', async () => {
      service.triggerScanForOrganization.mockResolvedValue({ id: 'scan-1', status: 'Queued' });

      await controller.triggerScanForOrganization('org-1', { id: 'user-1' } as never, undefined);

      expect(service.triggerScanForOrganization).toHaveBeenCalledWith('org-1', 'user-1', undefined);
    });

    it('passes through an explicit microsoftTenantId from the request body', async () => {
      service.triggerScanForOrganization.mockResolvedValue({ id: 'scan-1', status: 'Queued' });

      await controller.triggerScanForOrganization('org-1', { id: 'user-1' } as never, { microsoftTenantId: 'tenant-9' });

      expect(service.triggerScanForOrganization).toHaveBeenCalledWith('org-1', 'user-1', 'tenant-9');
    });
  });
});
