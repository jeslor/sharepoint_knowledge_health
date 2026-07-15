import { recoverStaleScanJobs } from '@sph/database';
import { StaleScanRecoveryService } from './stale-scan-recovery.service';

jest.mock('@sph/database');

const mockedRecoverStaleScanJobs = recoverStaleScanJobs as jest.MockedFunction<typeof recoverStaleScanJobs>;

describe('StaleScanRecoveryService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls recoverStaleScanJobs once on module init with a 2-hour threshold', async () => {
    mockedRecoverStaleScanJobs.mockResolvedValue(0);
    const service = new StaleScanRecoveryService();

    await service.onModuleInit();

    expect(mockedRecoverStaleScanJobs).toHaveBeenCalledTimes(1);
    const [, thresholdMs] = mockedRecoverStaleScanJobs.mock.calls[0]!;
    expect(thresholdMs).toBe(2 * 60 * 60 * 1000);
  });

  it('does not throw when jobs were recovered', async () => {
    mockedRecoverStaleScanJobs.mockResolvedValue(3);
    const service = new StaleScanRecoveryService();

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });
});
