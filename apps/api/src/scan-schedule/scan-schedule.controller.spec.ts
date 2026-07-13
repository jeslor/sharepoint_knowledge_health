import { BadRequestException } from '@nestjs/common';
import { ScanScheduleController } from './scan-schedule.controller';
import type { ScanScheduleService } from './scan-schedule.service';

describe('ScanScheduleController', () => {
  const service = {
    getSchedule: jest.fn(),
    createSchedule: jest.fn(),
    updateSchedule: jest.fn(),
    deleteSchedule: jest.fn(),
  };
  const controller = new ScanScheduleController(service as unknown as ScanScheduleService);

  beforeEach(() => jest.clearAllMocks());

  it('getSchedule delegates organizationId from the route', async () => {
    service.getSchedule.mockResolvedValue(null);

    await controller.getSchedule('org-1');

    expect(service.getSchedule).toHaveBeenCalledWith('org-1');
  });

  describe('createSchedule', () => {
    it('delegates organizationId and body when frequency is valid', async () => {
      service.createSchedule.mockResolvedValue({ id: 'schedule-1' });

      await controller.createSchedule('org-1', { frequency: 'Daily' });

      expect(service.createSchedule).toHaveBeenCalledWith('org-1', { frequency: 'Daily' });
    });

    it('rejects an invalid frequency with 400 before calling the service', async () => {
      await expect(controller.createSchedule('org-1', { frequency: 'Hourly' as never })).rejects.toThrow(
        BadRequestException,
      );
      expect(service.createSchedule).not.toHaveBeenCalled();
    });
  });

  describe('updateSchedule', () => {
    it('rejects an empty body (neither frequency nor enabled given)', async () => {
      await expect(controller.updateSchedule('org-1', {})).rejects.toThrow(BadRequestException);
      expect(service.updateSchedule).not.toHaveBeenCalled();
    });

    it('accepts a bare enabled toggle', async () => {
      service.updateSchedule.mockResolvedValue({ id: 'schedule-1', enabled: false });

      await controller.updateSchedule('org-1', { enabled: false });

      expect(service.updateSchedule).toHaveBeenCalledWith('org-1', { enabled: false });
    });

    it('rejects an invalid frequency with 400', async () => {
      await expect(controller.updateSchedule('org-1', { frequency: 'Monthly' as never })).rejects.toThrow(
        BadRequestException,
      );
      expect(service.updateSchedule).not.toHaveBeenCalled();
    });
  });

  it('deleteSchedule delegates organizationId from the route', async () => {
    service.deleteSchedule.mockResolvedValue(undefined);

    await controller.deleteSchedule('org-1');

    expect(service.deleteSchedule).toHaveBeenCalledWith('org-1');
  });
});
