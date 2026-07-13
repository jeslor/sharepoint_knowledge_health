import { ConflictException, NotFoundException } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import { ScanScheduleService } from './scan-schedule.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('ScanScheduleService', () => {
  const service = new ScanScheduleService();
  const scanSchedules = { findMany: jest.fn(), create: jest.fn(), updateById: jest.fn(), deleteById: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ scanSchedules } as never);
  });

  describe('getSchedule', () => {
    it('returns null when the organization has no schedule configured', async () => {
      scanSchedules.findMany.mockResolvedValue([]);

      const result = await service.getSchedule('org-1');

      expect(result).toBeNull();
    });

    it('returns the mapped schedule when one exists (org isolation via createTenantContext)', async () => {
      scanSchedules.findMany.mockResolvedValue([
        {
          id: 'schedule-1',
          frequency: 'Weekly',
          enabled: true,
          nextRunAt: new Date('2026-07-20T02:00:00.000Z'),
          lastRunAt: new Date('2026-07-13T02:00:00.000Z'),
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ]);

      const result = await service.getSchedule('org-1');

      expect(mockedCreateContext).toHaveBeenCalledWith('org-1');
      expect(result).toEqual({
        id: 'schedule-1',
        frequency: 'Weekly',
        enabled: true,
        nextRunAt: '2026-07-20T02:00:00.000Z',
        lastRunAt: '2026-07-13T02:00:00.000Z',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      });
    });
  });

  describe('createSchedule', () => {
    it('creates a schedule with nextRunAt one interval from now', async () => {
      scanSchedules.findMany.mockResolvedValue([]);
      scanSchedules.create.mockResolvedValue({
        id: 'schedule-1',
        frequency: 'Daily',
        enabled: true,
        nextRunAt: new Date('2026-07-14T00:00:00.000Z'),
        lastRunAt: null,
        createdAt: new Date('2026-07-13T00:00:00.000Z'),
        updatedAt: new Date('2026-07-13T00:00:00.000Z'),
      });

      await service.createSchedule('org-1', { frequency: 'Daily' });

      expect(scanSchedules.create).toHaveBeenCalledWith(
        expect.objectContaining({ frequency: 'Daily', enabled: true }),
      );
    });

    it('throws ConflictException when the organization already has a schedule', async () => {
      scanSchedules.findMany.mockResolvedValue([{ id: 'schedule-1' }]);

      await expect(service.createSchedule('org-1', { frequency: 'Daily' })).rejects.toThrow(ConflictException);
      expect(scanSchedules.create).not.toHaveBeenCalled();
    });
  });

  describe('updateSchedule', () => {
    it('throws NotFoundException when no schedule exists yet', async () => {
      scanSchedules.findMany.mockResolvedValue([]);

      await expect(service.updateSchedule('org-1', { enabled: false })).rejects.toThrow(NotFoundException);
    });

    it('updates enabled without recomputing nextRunAt', async () => {
      scanSchedules.findMany.mockResolvedValue([
        { id: 'schedule-1', frequency: 'Daily', nextRunAt: new Date('2026-07-14T00:00:00.000Z') },
      ]);
      scanSchedules.updateById.mockResolvedValue({
        id: 'schedule-1',
        frequency: 'Daily',
        enabled: false,
        nextRunAt: new Date('2026-07-14T00:00:00.000Z'),
        lastRunAt: null,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-13T00:00:00.000Z'),
      });

      await service.updateSchedule('org-1', { enabled: false });

      expect(scanSchedules.updateById).toHaveBeenCalledWith('schedule-1', { enabled: false });
    });

    it('recomputes nextRunAt when frequency changes', async () => {
      scanSchedules.findMany.mockResolvedValue([
        { id: 'schedule-1', frequency: 'Weekly', nextRunAt: new Date('2026-07-20T00:00:00.000Z') },
      ]);
      scanSchedules.updateById.mockResolvedValue({
        id: 'schedule-1',
        frequency: 'Daily',
        enabled: true,
        nextRunAt: new Date('2026-07-14T00:00:00.000Z'),
        lastRunAt: null,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-13T00:00:00.000Z'),
      });

      await service.updateSchedule('org-1', { frequency: 'Daily' });

      const [, updateArgs] = scanSchedules.updateById.mock.calls[0] as [string, { frequency: string; nextRunAt: Date }];
      expect(updateArgs.frequency).toBe('Daily');
      expect(updateArgs.nextRunAt).toBeInstanceOf(Date);
    });

    it('does not recompute nextRunAt when frequency is unchanged', async () => {
      scanSchedules.findMany.mockResolvedValue([
        { id: 'schedule-1', frequency: 'Daily', nextRunAt: new Date('2026-07-14T00:00:00.000Z') },
      ]);
      scanSchedules.updateById.mockResolvedValue({
        id: 'schedule-1',
        frequency: 'Daily',
        enabled: true,
        nextRunAt: new Date('2026-07-14T00:00:00.000Z'),
        lastRunAt: null,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-13T00:00:00.000Z'),
      });

      await service.updateSchedule('org-1', { frequency: 'Daily' });

      expect(scanSchedules.updateById).toHaveBeenCalledWith('schedule-1', { frequency: 'Daily' });
    });
  });

  describe('deleteSchedule', () => {
    it('throws NotFoundException when no schedule exists', async () => {
      scanSchedules.findMany.mockResolvedValue([]);

      await expect(service.deleteSchedule('org-1')).rejects.toThrow(NotFoundException);
    });

    it('deletes the organization\'s schedule', async () => {
      scanSchedules.findMany.mockResolvedValue([{ id: 'schedule-1' }]);
      scanSchedules.deleteById.mockResolvedValue(true);

      await service.deleteSchedule('org-1');

      expect(scanSchedules.deleteById).toHaveBeenCalledWith('schedule-1');
    });
  });
});
