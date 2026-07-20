import { NotFoundException } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import type { Queue } from 'bullmq';
import { DiscoveryProducerService } from './discovery-producer.service';

// shouldEnqueueDiscovery/discoveryJobId are pure and already fully covered
// in isolation (packages/database/src/discovery.spec.ts) — keep the real
// implementations here so this service's own logic is what's under test,
// not an auto-mocked stand-in that would always return undefined.
jest.mock('@sph/database', () => ({
  ...jest.requireActual('@sph/database'),
  createTenantContext: jest.fn(),
}));

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('DiscoveryProducerService (ADR-0014 amendment)', () => {
  const microsoftTenants = { findFirstById: jest.fn(), updateById: jest.fn() };
  const queue = { add: jest.fn() };

  const service = new DiscoveryProducerService(queue as unknown as Queue);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ microsoftTenants } as never);
    queue.add.mockResolvedValue(undefined);
  });

  it('throws NotFoundException when the microsoft tenant does not exist', async () => {
    microsoftTenants.findFirstById.mockResolvedValue(null);

    await expect(service.enqueueDiscovery('org-1', 'tenant-missing')).rejects.toThrow(NotFoundException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('sets discoveryStatus to Queued and enqueues a job carrying only { organizationId, microsoftTenantId }', async () => {
    microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', discoveryStatus: 'NotStarted' });
    const queued = { id: 'tenant-1', discoveryStatus: 'Queued' };
    microsoftTenants.updateById.mockResolvedValue(queued);

    const result = await service.enqueueDiscovery('org-1', 'tenant-1');

    expect(microsoftTenants.updateById).toHaveBeenCalledWith('tenant-1', { discoveryStatus: 'Queued' });
    expect(queue.add).toHaveBeenCalledWith(
      'discover',
      { organizationId: 'org-1', microsoftTenantId: 'tenant-1' },
      { jobId: 'discovery-tenant-1' },
    );
    expect(result).toBe(queued);
  });

  it.each(['Queued', 'Running'] as const)(
    'no-ops safely (does not enqueue or write) when discoveryStatus is already %s',
    async (discoveryStatus) => {
      const tenant = { id: 'tenant-1', discoveryStatus };
      microsoftTenants.findFirstById.mockResolvedValue(tenant);

      const result = await service.enqueueDiscovery('org-1', 'tenant-1');

      expect(microsoftTenants.updateById).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(result).toBe(tenant);
    },
  );

  it.each(['Failed', 'Completed', 'NotStarted'] as const)(
    'allows enqueueing again when discoveryStatus is %s',
    async (discoveryStatus) => {
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', discoveryStatus });
      microsoftTenants.updateById.mockResolvedValue({ id: 'tenant-1', discoveryStatus: 'Queued' });

      await service.enqueueDiscovery('org-1', 'tenant-1');

      expect(queue.add).toHaveBeenCalledTimes(1);
    },
  );

  describe('when queue.add() fails', () => {
    it('marks discoveryStatus Failed with the underlying error message, then re-throws the original error', async () => {
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', discoveryStatus: 'NotStarted' });
      microsoftTenants.updateById.mockResolvedValueOnce({ id: 'tenant-1', discoveryStatus: 'Queued' });
      const enqueueError = new Error('connect ECONNREFUSED 127.0.0.1:6379');
      queue.add.mockRejectedValue(enqueueError);
      microsoftTenants.updateById.mockResolvedValueOnce({ id: 'tenant-1', discoveryStatus: 'Failed' });

      await expect(service.enqueueDiscovery('org-1', 'tenant-1')).rejects.toBe(enqueueError);

      expect(microsoftTenants.updateById).toHaveBeenLastCalledWith('tenant-1', {
        discoveryStatus: 'Failed',
        discoveryCompletedAt: expect.any(Date),
        discoveryError: 'Failed to enqueue discovery: connect ECONNREFUSED 127.0.0.1:6379',
      });
    });

    it('does not leave the tenant orphaned at Queued — a subsequent attempt is not blocked by it', async () => {
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', discoveryStatus: 'NotStarted' });
      microsoftTenants.updateById.mockResolvedValue({ id: 'tenant-1', discoveryStatus: 'Queued' });
      queue.add.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379'));

      await expect(service.enqueueDiscovery('org-1', 'tenant-1')).rejects.toThrow();

      // Compensating write already took effect (discoveryStatus: Failed) —
      // a second attempt must be allowed through, not blocked.
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', discoveryStatus: 'Failed' });
      queue.add.mockResolvedValue(undefined);

      await service.enqueueDiscovery('org-1', 'tenant-1');
      expect(queue.add).toHaveBeenCalledTimes(2);
    });

    it('re-throws the original enqueue error, not the compensating write error, if the compensating write also fails', async () => {
      microsoftTenants.findFirstById.mockResolvedValue({ id: 'tenant-1', discoveryStatus: 'NotStarted' });
      microsoftTenants.updateById.mockResolvedValueOnce({ id: 'tenant-1', discoveryStatus: 'Queued' });
      const enqueueError = new Error('connect ECONNREFUSED 127.0.0.1:6379');
      queue.add.mockRejectedValue(enqueueError);
      microsoftTenants.updateById.mockRejectedValueOnce(new Error('Postgres also unavailable'));

      await expect(service.enqueueDiscovery('org-1', 'tenant-1')).rejects.toBe(enqueueError);
    });
  });
});
