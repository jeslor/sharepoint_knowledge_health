import { recoverStaleDiscoveries } from '@sph/database';
import { StaleDiscoveryRecoveryService } from './stale-discovery-recovery.service';

jest.mock('@sph/database');

const mockedRecoverStaleDiscoveries = recoverStaleDiscoveries as jest.MockedFunction<typeof recoverStaleDiscoveries>;

describe('StaleDiscoveryRecoveryService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls recoverStaleDiscoveries once on module init with a 30-minute threshold', async () => {
    mockedRecoverStaleDiscoveries.mockResolvedValue(0);
    const service = new StaleDiscoveryRecoveryService();

    await service.onModuleInit();

    expect(mockedRecoverStaleDiscoveries).toHaveBeenCalledTimes(1);
    const [, thresholdMs] = mockedRecoverStaleDiscoveries.mock.calls[0]!;
    expect(thresholdMs).toBe(30 * 60 * 1000);
  });

  it('does not throw when tenants were recovered', async () => {
    mockedRecoverStaleDiscoveries.mockResolvedValue(2);
    const service = new StaleDiscoveryRecoveryService();

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });
});
