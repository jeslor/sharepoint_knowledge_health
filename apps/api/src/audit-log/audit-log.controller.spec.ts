import { BadRequestException } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller';
import type { AuditLogService } from './audit-log.service';

describe('AuditLogController', () => {
  const service = { list: jest.fn() };
  const controller = new AuditLogController(service as unknown as AuditLogService);

  beforeEach(() => jest.clearAllMocks());

  describe('list', () => {
    it('delegates organizationId and default-parsed query when no params are supplied', async () => {
      service.list.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });

      await controller.list('org-1', {});

      expect(service.list).toHaveBeenCalledWith('org-1', {
        page: undefined,
        pageSize: undefined,
        action: undefined,
        targetType: undefined,
        sortDir: undefined,
        since: undefined,
        until: undefined,
      });
    });

    it('parses valid query params through', async () => {
      service.list.mockResolvedValue({ data: [], pagination: { page: 2, pageSize: 10, total: 0, totalPages: 1 } });

      await controller.list('org-1', {
        page: '2',
        pageSize: '10',
        action: 'sharepoint_site.approved',
        targetType: 'SharePointSite',
        sortDir: 'asc',
        since: '2026-07-01T00:00:00.000Z',
      });

      expect(service.list).toHaveBeenCalledWith('org-1', {
        page: 2,
        pageSize: 10,
        action: 'sharepoint_site.approved',
        targetType: 'SharePointSite',
        sortDir: 'asc',
        since: '2026-07-01T00:00:00.000Z',
        until: undefined,
      });
    });

    it.each([
      ['page', { page: '0' }],
      ['pageSize', { pageSize: '101' }],
      ['sortDir', { sortDir: 'bogus' }],
      ['since', { since: 'not-a-date' }],
      ['until', { until: 'not-a-date' }],
    ])('rejects an invalid %s value with 400', async (_label, badQuery) => {
      await expect(controller.list('org-1', badQuery)).rejects.toThrow(BadRequestException);
      expect(service.list).not.toHaveBeenCalled();
    });
  });
});
