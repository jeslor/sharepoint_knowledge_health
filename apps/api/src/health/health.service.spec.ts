import { checkDatabaseConnection } from '@sph/database';
import type { Queue } from 'bullmq';
import { HealthService } from './health.service';

jest.mock('@sph/database');

const mockedCheckDatabaseConnection = checkDatabaseConnection as jest.MockedFunction<typeof checkDatabaseConnection>;

describe('HealthService', () => {
  const clientMock = { info: jest.fn() };
  const queue = { client: Promise.resolve(clientMock) };
  const service = new HealthService(queue as unknown as Queue);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckDatabaseConnection.mockResolvedValue(true);
    clientMock.info.mockResolvedValue('redis_version:7.0.0');
  });

  describe('getStatus', () => {
    it('always reports ok — liveness never depends on external services', () => {
      const result = service.getStatus();
      expect(result.status).toBe('ok');
      expect(typeof result.timestamp).toBe('string');
    });
  });

  describe('getReadiness', () => {
    it('reports ok when both database and redis are reachable', async () => {
      const result = await service.getReadiness();
      expect(result).toEqual({
        status: 'ok',
        timestamp: expect.any(String),
        checks: { database: 'ok', redis: 'ok' },
      });
    });

    it('reports degraded when the database is unreachable', async () => {
      mockedCheckDatabaseConnection.mockResolvedValue(false);
      const result = await service.getReadiness();
      expect(result.status).toBe('degraded');
      expect(result.checks).toEqual({ database: 'error', redis: 'ok' });
    });

    it('reports degraded when redis is unreachable', async () => {
      clientMock.info.mockRejectedValue(new Error('connection refused'));
      const result = await service.getReadiness();
      expect(result.status).toBe('degraded');
      expect(result.checks).toEqual({ database: 'ok', redis: 'error' });
    });

    it('reports degraded when both are unreachable', async () => {
      mockedCheckDatabaseConnection.mockResolvedValue(false);
      clientMock.info.mockRejectedValue(new Error('connection refused'));
      const result = await service.getReadiness();
      expect(result.status).toBe('degraded');
      expect(result.checks).toEqual({ database: 'error', redis: 'error' });
    });
  });
});
