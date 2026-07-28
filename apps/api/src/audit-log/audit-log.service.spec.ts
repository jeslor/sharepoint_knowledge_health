import { createTenantContext } from '@sph/database';
import { AuditLogService } from './audit-log.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('AuditLogService', () => {
  const service = new AuditLogService();

  const auditLogs = { findMany: jest.fn(), count: jest.fn(), create: jest.fn() };
  const users = { findMany: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ auditLogs, users } as never);
    auditLogs.findMany.mockResolvedValue([]);
    auditLogs.count.mockResolvedValue(0);
    users.findMany.mockResolvedValue([]);
  });

  describe('record', () => {
    it('creates a row with organizationId scoping delegated to the repository (ADR-0001)', async () => {
      await service.record('org-1', {
        actorUserId: 'user-1',
        action: 'sharepoint_site.approved',
        targetType: 'SharePointSite',
        targetId: 'site-1',
      });

      expect(mockedCreateContext).toHaveBeenCalledWith('org-1');
      expect(auditLogs.create).toHaveBeenCalledWith({
        actorUserId: 'user-1',
        action: 'sharepoint_site.approved',
        targetType: 'SharePointSite',
        targetId: 'site-1',
        metadata: undefined,
      });
    });

    it('passes metadata through unchanged when provided', async () => {
      await service.record('org-1', {
        actorUserId: 'user-1',
        action: 'scan_schedule.updated',
        targetType: 'ScanSchedule',
        targetId: 'schedule-1',
        metadata: { enabled: false },
      });

      expect(auditLogs.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: { enabled: false } }));
    });

    it('accepts a null actorUserId for a future system-driven event', async () => {
      await service.record('org-1', {
        actorUserId: null,
        action: 'microsoft_tenant.connected',
        targetType: 'MicrosoftTenant',
        targetId: 'tenant-1',
      });

      expect(auditLogs.create).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: null }));
    });
  });

  describe('list', () => {
    it('paginates and enriches entries with the actor\'s display name (batched, no N+1)', async () => {
      auditLogs.findMany.mockResolvedValue([
        {
          id: 'log-1',
          actorUserId: 'user-1',
          action: 'sharepoint_site.approved',
          targetType: 'SharePointSite',
          targetId: 'site-1',
          metadata: null,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ]);
      auditLogs.count.mockResolvedValue(1);
      users.findMany.mockResolvedValue([{ id: 'user-1', displayName: 'Alice' }]);

      const result = await service.list('org-1', {});

      expect(users.findMany).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        data: [
          {
            id: 'log-1',
            actorUserId: 'user-1',
            actorUserName: 'Alice',
            action: 'sharepoint_site.approved',
            targetType: 'SharePointSite',
            targetId: 'site-1',
            metadata: null,
            createdAt: '2026-07-01T00:00:00.000Z',
          },
        ],
        pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
      });
    });

    it('renders a null actorUserId (system-driven event) as a null actorUserName, without a user lookup', async () => {
      auditLogs.findMany.mockResolvedValue([
        {
          id: 'log-1',
          actorUserId: null,
          action: 'microsoft_tenant.connected',
          targetType: 'MicrosoftTenant',
          targetId: 'tenant-1',
          metadata: null,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ]);
      auditLogs.count.mockResolvedValue(1);

      const [result] = (await service.list('org-1', {})).data;

      expect(users.findMany).not.toHaveBeenCalled();
      expect(result?.actorUserName).toBeNull();
    });

    it('applies action/targetType/date-range filters to both the list and count queries', async () => {
      await service.list('org-1', { action: 'scan.triggered', targetType: 'ScanJob', since: '2026-07-01T00:00:00.000Z' });

      const expectedWhere = {
        action: 'scan.triggered',
        targetType: 'ScanJob',
        createdAt: { gte: new Date('2026-07-01T00:00:00.000Z') },
      };
      expect(auditLogs.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }));
      expect(auditLogs.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('returns an empty page without querying users when there are no entries', async () => {
      auditLogs.findMany.mockResolvedValue([]);
      auditLogs.count.mockResolvedValue(0);

      const result = await service.list('org-1', {});

      expect(users.findMany).not.toHaveBeenCalled();
      expect(result).toEqual({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });
    });
  });
});
