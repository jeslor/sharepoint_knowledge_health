import { shouldEnqueueDiscovery, discoveryJobId } from './discovery';

describe('shouldEnqueueDiscovery (ADR-0014 amendment — discoveryStatus is the authoritative concurrency guard)', () => {
  it('allows enqueueing when discoveryStatus is NotStarted', () => {
    expect(shouldEnqueueDiscovery({ discoveryStatus: 'NotStarted' })).toBe(true);
  });

  it('blocks enqueueing when discoveryStatus is Queued', () => {
    expect(shouldEnqueueDiscovery({ discoveryStatus: 'Queued' })).toBe(false);
  });

  it('blocks enqueueing when discoveryStatus is Running', () => {
    expect(shouldEnqueueDiscovery({ discoveryStatus: 'Running' })).toBe(false);
  });

  it('allows re-enqueueing (rediscovery) when discoveryStatus is Failed', () => {
    expect(shouldEnqueueDiscovery({ discoveryStatus: 'Failed' })).toBe(true);
  });

  it('allows re-enqueueing (rediscovery) when discoveryStatus is Completed', () => {
    expect(shouldEnqueueDiscovery({ discoveryStatus: 'Completed' })).toBe(true);
  });
});

describe('discoveryJobId', () => {
  it('is deterministic per tenant, for BullMQ dedup as a secondary guard', () => {
    expect(discoveryJobId('tenant-1')).toBe('discovery-tenant-1');
    expect(discoveryJobId('tenant-1')).toBe(discoveryJobId('tenant-1'));
  });

  it('differs across tenants', () => {
    expect(discoveryJobId('tenant-1')).not.toBe(discoveryJobId('tenant-2'));
  });
});
