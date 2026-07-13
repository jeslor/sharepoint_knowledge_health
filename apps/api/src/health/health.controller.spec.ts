import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import type { HealthService } from './health.service';

describe('HealthController', () => {
  const service = { getStatus: jest.fn(), getReadiness: jest.fn() };
  const controller = new HealthController(service as unknown as HealthService);

  beforeEach(() => jest.clearAllMocks());

  it('returns an ok status with a timestamp', () => {
    service.getStatus.mockReturnValue({ status: 'ok', timestamp: '2026-07-13T00:00:00.000Z' });

    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(typeof result.timestamp).toBe('string');
  });

  describe('ready', () => {
    it('returns the readiness result directly when status is ok', async () => {
      const readiness = { status: 'ok' as const, timestamp: '2026-07-13T00:00:00.000Z', checks: { database: 'ok' as const, redis: 'ok' as const } };
      service.getReadiness.mockResolvedValue(readiness);

      const result = await controller.ready();

      expect(result).toEqual(readiness);
    });

    it('throws ServiceUnavailableException (503) carrying the readiness body when degraded', async () => {
      const readiness = { status: 'degraded' as const, timestamp: '2026-07-13T00:00:00.000Z', checks: { database: 'error' as const, redis: 'ok' as const } };
      service.getReadiness.mockResolvedValue(readiness);

      await expect(controller.ready()).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
