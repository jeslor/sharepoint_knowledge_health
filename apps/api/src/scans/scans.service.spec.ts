import { ConflictException, NotFoundException } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import type { Queue } from 'bullmq';
import { ScansService } from './scans.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('ScansService', () => {
  const microsoftTenants = { findFirstById: jest.fn(), findMany: jest.fn() };
  const scanJobs = { create: jest.fn(), findFirstById: jest.fn(), findMany: jest.fn() };
  const queue = { add: jest.fn() };

  const service = new ScansService(queue as unknown as Queue);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ microsoftTenants, scanJobs } as never);
    scanJobs.findMany.mockResolvedValue([]); // no scan already in flight, by default
  });

  describe('triggerScan', () => {
    it('throws NotFoundException when the microsoft tenant does not exist', async () => {
      microsoftTenants.findFirstById.mockResolvedValue(null);

      await expect(service.triggerScan('org-1', 'tenant-missing', 'user-1')).rejects.toThrow(NotFoundException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('creates a Queued ScanJob and enqueues a job carrying only { organizationId, scanJobId }', async () => {
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1' });
      const scanJob = { id: 'scan-1', status: 'Queued' };
      scanJobs.create.mockResolvedValue(scanJob);

      const result = await service.triggerScan('org-1', 'tenant-1', 'user-1');

      expect(scanJobs.create).toHaveBeenCalledWith({
        microsoftTenantId: 'tenant-1',
        triggeredByUserId: 'user-1',
        status: 'Queued',
      });
      expect(queue.add).toHaveBeenCalledWith('scan', { organizationId: 'org-1', scanJobId: 'scan-1' });
      expect(result).toBe(scanJob);
    });

    it('rejects with 409 when a scan is already Queued or Running for this Microsoft tenant', async () => {
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1' });
      scanJobs.findMany.mockResolvedValue([{ id: 'scan-existing', status: 'Running' }]);

      await expect(service.triggerScan('org-1', 'tenant-1', 'user-1')).rejects.toThrow(ConflictException);
      expect(scanJobs.create).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('getScan', () => {
    it('throws NotFoundException when the scan job does not exist for this organization', async () => {
      scanJobs.findFirstById.mockResolvedValue(null);

      await expect(service.getScan('org-1', 'scan-missing')).rejects.toThrow(NotFoundException);
    });

    it('returns the scan job when found', async () => {
      const scanJob = { id: 'scan-1', status: 'Running' };
      scanJobs.findFirstById.mockResolvedValue(scanJob);

      const result = await service.getScan('org-1', 'scan-1');

      expect(result).toBe(scanJob);
    });
  });

  describe('listScans', () => {
    it('returns the most recent scans for this organization only, ordered newest first', async () => {
      const scanJob = {
        id: 'scan-1',
        microsoftTenantId: 'tenant-1',
        triggeredByUserId: 'user-1',
        status: 'Completed',
        startedAt: new Date('2026-07-01T00:00:00.000Z'),
        completedAt: new Date('2026-07-01T01:00:00.000Z'),
        documentsScanned: 10,
        documentsFailed: 0,
        errorSummary: null,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      };
      scanJobs.findMany.mockResolvedValue([scanJob]);

      const result = await service.listScans('org-1');

      expect(scanJobs.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, take: 50 });
      expect(mockedCreateContext).toHaveBeenCalledWith('org-1');
      expect(result).toEqual([
        {
          id: 'scan-1',
          microsoftTenantId: 'tenant-1',
          triggeredByUserId: 'user-1',
          status: 'Completed',
          startedAt: '2026-07-01T00:00:00.000Z',
          completedAt: '2026-07-01T01:00:00.000Z',
          documentsScanned: 10,
          documentsFailed: 0,
          errorSummary: null,
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ]);
    });
  });

  describe('triggerScanForOrganization', () => {
    it('delegates straight to triggerScan when microsoftTenantId is explicitly given', async () => {
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1' });
      scanJobs.create.mockResolvedValue({ id: 'scan-1' });

      await service.triggerScanForOrganization('org-1', 'user-1', 'tenant-1');

      expect(microsoftTenants.findFirstById).toHaveBeenCalledWith('tenant-1');
      expect(microsoftTenants.findMany).not.toHaveBeenCalled();
    });

    it('auto-resolves the single Consented tenant when none is specified', async () => {
      microsoftTenants.findMany.mockResolvedValue([{ id: 'tenant-only', status: 'Consented' }]);
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-only' });
      scanJobs.create.mockResolvedValue({ id: 'scan-1' });

      await service.triggerScanForOrganization('org-1', 'user-1');

      expect(microsoftTenants.findMany).toHaveBeenCalledWith({ where: { status: 'Consented' } });
      expect(microsoftTenants.findFirstById).toHaveBeenCalledWith('tenant-only');
    });

    it('throws NotFoundException when the organization has no connected Microsoft tenant', async () => {
      microsoftTenants.findMany.mockResolvedValue([]);

      await expect(service.triggerScanForOrganization('org-1', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException (ambiguous) when the organization has more than one connected tenant', async () => {
      microsoftTenants.findMany.mockResolvedValue([{ id: 'tenant-a' }, { id: 'tenant-b' }]);

      await expect(service.triggerScanForOrganization('org-1', 'user-1')).rejects.toThrow(ConflictException);
    });
  });
});
